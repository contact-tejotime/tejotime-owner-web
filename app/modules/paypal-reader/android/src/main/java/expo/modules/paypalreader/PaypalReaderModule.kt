package expo.modules.paypalreader

import android.app.Activity
import android.os.Handler
import android.os.Looper
import androidx.lifecycle.Observer
import androidx.lifecycle.ProcessLifecycleOwner
import com.zettle.sdk.ZettleSDK
import com.zettle.sdk.ZettleSDKLifecycle
import com.zettle.sdk.config
import com.zettle.sdk.core.auth.User
import com.zettle.sdk.feature.cardreader.payment.PayPalReaderTippingStyle
import com.zettle.sdk.feature.cardreader.payment.TippingConfiguration
import com.zettle.sdk.feature.cardreader.payment.TransactionReference
import com.zettle.sdk.feature.cardreader.payment.ZettleReaderTippingStyle
import com.zettle.sdk.feature.cardreader.payment.failure.CardFailureReason
import com.zettle.sdk.feature.cardreader.payment.refunds.RefundFailureReason
import com.zettle.sdk.feature.cardreader.payment.refunds.RetrieveCardPaymentFailureReason
import com.zettle.sdk.feature.cardreader.ui.CardReaderAction
import com.zettle.sdk.feature.cardreader.ui.CardReaderFeature
import com.zettle.sdk.feature.cardreader.ui.RetrieveResult
import com.zettle.sdk.feature.cardreader.ui.payment.CardPaymentResult
import com.zettle.sdk.feature.cardreader.ui.refunds.RefundResult
import com.zettle.sdk.features.charge
import com.zettle.sdk.features.refund
import com.zettle.sdk.features.retrieve
import com.zettle.sdk.features.show
import com.zettle.sdk.ui.ZettleResult
import com.zettle.sdk.ui.zettleResult
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

/**
 * PayPal POS Card Reader, through PayPal's Zettle Payments SDK (docs/card-payments-paypal.md).
 * JS reaches it only through app/src/lib/card-reader.ts, whose `NativePaypalReader` interface this
 * implements; amounts are minor units (cents) on both sides.
 *
 * Written from PayPal's example app, iZettle/sdk-android Examples/Example-Kotlin.
 *
 * The one rule that shapes every result below: card-payment-flow.ts treats `failed` /
 * `not_found` as "no money moved" and fails the payment on the server. So anything that cannot
 * say for certain — a network error mid-authorisation, an activity that came back with no result —
 * REJECTS instead, which leaves the payment pending for recovery (`retrieve` on next launch, or
 * "Check with PayPal"). Charging a customer twice is the mistake this module must never enable.
 */
class PaypalReaderModule : Module() {
  private var pendingCharge: Promise? = null
  private var pendingRefund: Promise? = null

  private var pendingLogin: Promise? = null
  private var loginObserver: Observer<User.AuthState>? = null
  private var loginLeftApp = false

  private val main = Handler(Looper.getMainLooper())

  override fun definition() = ModuleDefinition {
    Name("PaypalReader")

    AsyncFunction("configure") { opts: ConfigureOptions ->
      // Once per process: the SDK cannot be configured twice, and JS only calls this again after
      // a failure, so an initialised SDK is already the answer.
      if (ZettleSDK.isInitialized) return@AsyncFunction
      val context = appContext.reactContext?.applicationContext
        ?: throw CodedException("ERR_NO_CONTEXT", "No Android context to start PayPal's SDK", null)
      val configuration = config(context) {
        isDevMode = opts.devMode
        auth {
          clientId = opts.clientId
          redirectUrl = opts.redirectUrl
        }
        logging {
          allowWhileRoaming = false
        }
        addFeature(CardReaderFeature)
      }
      ZettleSDK.configure(configuration)
      // Added while the app is already in the foreground, the observer is replayed ON_START at
      // once, which is what starts the SDK (PayPal's example leaves `start()` to it as well).
      ProcessLifecycleOwner.get().lifecycle.addObserver(ZettleSDKLifecycle())
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("isLoggedIn") {
      sdk().isLoggedIn
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("login") { promise: Promise ->
      val sdk = sdk()
      if (sdk.isLoggedIn) {
        promise.resolve(true)
        return@AsyncFunction
      }
      if (pendingLogin != null) {
        promise.reject(CodedException("ERR_BUSY", "PayPal sign-in is already open", null))
        return@AsyncFunction
      }
      val activity = activity()
      pendingLogin = promise
      loginLeftApp = false
      var sawLoggingIn = false
      val observer = Observer<User.AuthState> { state ->
        when (state) {
          is User.AuthState.LoggedIn -> finishLogin(true)
          is User.AuthState.LoggingIn -> sawLoggingIn = true
          // The current state is replayed on subscribe (LoggedOut, before anything happened), so a
          // logged-out state only answers once a sign-in was actually under way.
          is User.AuthState.LoggedOut -> if (sawLoggingIn) finishLogin(false)
          else -> Unit
        }
      }
      loginObserver = observer
      sdk.authState.observeForever(observer)
      sdk.login(activity, null)
    }.runOnQueue(Queues.MAIN)

    // Closing PayPal's sign-in page without signing in reports no auth state at all, so the
    // owner coming back to the app is the only signal. A sign-in that DID finish is still
    // exchanging its token at that moment (LoggingIn) — the observer answers that one.
    OnActivityEntersBackground {
      if (pendingLogin != null) loginLeftApp = true
    }
    OnActivityEntersForeground {
      if (pendingLogin != null && loginLeftApp) {
        main.postDelayed({
          val state = if (ZettleSDK.isInitialized) ZettleSDK.instance?.authState?.value else null
          if (pendingLogin != null && state !is User.AuthState.LoggingIn) {
            finishLogin(state is User.AuthState.LoggedIn)
          }
        }, 1500)
      }
    }

    AsyncFunction("logout") { promise: Promise ->
      sdk().logout { promise.resolve(null) }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("account") {
      val state = sdk().authState.value as? User.AuthState.LoggedIn ?: return@AsyncFunction null
      val info = state.info
      mapOf(
        "orgRef" to info.organizationId,
        "currency" to info.currency?.name,
        "country" to info.country?.name,
        "name" to info.publicName,
      )
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("openReaderSettings") {
      sdk()
      val activity = activity()
      activity.startActivity(CardReaderAction.Settings.show(activity))
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("charge") { opts: ChargeOptions, promise: Promise ->
      sdk()
      if (pendingCharge != null) {
        promise.reject(CodedException("ERR_BUSY", "A card payment is already on the reader", null))
        return@AsyncFunction
      }
      val activity = activity()
      // The reference is TejoTime's card_payment id: it is what `retrieve` looks the charge up by
      // after a lost answer, so it must be exactly that id and nothing else.
      val reference = TransactionReference.Builder(opts.reference).build()
      val action = CardReaderAction.Payment(
        reference = reference,
        amount = opts.amountMinor,
        // Tipping is always off (client decision 2026-10-15): the reader charges the bill only.
        tippingConfiguration = TippingConfiguration(
          ZettleReaderTippingStyle.None,
          PayPalReaderTippingStyle.None,
        ),
      )
      pendingCharge = promise
      activity.startActivityForResult(action.charge(activity), REQUEST_CHARGE)
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("retrieve") { reference: String, promise: Promise ->
      sdk()
      CardReaderAction.Transaction(reference).retrieve { result ->
        when (result) {
          is ZettleResult.Completed<*> -> {
            val payload = CardReaderAction.fromRetrieveTransactionResult(result).payload
            promise.resolve(
              mapOf(
                "status" to "completed",
                "amountMinor" to payload.amount,
                "cardBrand" to payload.cardType,
                "cardLast4" to lastFour(payload.cardLastDigits),
                "entryMode" to payload.cardPaymentEntryMode,
                "transactionId" to payload.transactionId,
              ),
            )
          }
          is ZettleResult.Failed -> {
            val reason = (result as? RetrieveResult.Failed)?.reason ?: result.reason
            // Only "PayPal has no such charge" means nothing was taken. A network or auth error
            // knows nothing, and must not be reported as "not charged".
            if (reason is RetrieveCardPaymentFailureReason.NotFound) {
              promise.resolve(mapOf("status" to "not_found"))
            } else {
              promise.reject(CodedException("ERR_RETRIEVE", "PayPal could not be asked: ${name(reason)}", null))
            }
          }
          else -> promise.reject(CodedException("ERR_RETRIEVE", "PayPal could not be asked", null))
        }
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("refund") { opts: RefundOptions, promise: Promise ->
      sdk()
      if (pendingRefund != null) {
        promise.reject(CodedException("ERR_BUSY", "A refund is already open", null))
        return@AsyncFunction
      }
      val activity = activity()
      val action = CardReaderAction.Refund(
        amount = opts.amountMinor,
        paymentReferenceId = opts.reference,
        // Fixed per payment by the JS side, so a retry after a lost answer is the same refund.
        refundReference = TransactionReference.Builder(opts.refundReference).build(),
      )
      pendingRefund = promise
      activity.startActivityForResult(action.refund(activity), REQUEST_REFUND)
    }.runOnQueue(Queues.MAIN)

    OnActivityResult { _, payload ->
      when (payload.requestCode) {
        REQUEST_CHARGE -> {
          val promise = pendingCharge ?: return@OnActivityResult
          pendingCharge = null
          settleCharge(promise, if (payload.resultCode == Activity.RESULT_OK) payload.data?.zettleResult() else null)
        }
        REQUEST_REFUND -> {
          val promise = pendingRefund ?: return@OnActivityResult
          pendingRefund = null
          settleRefund(promise, if (payload.resultCode == Activity.RESULT_OK) payload.data?.zettleResult() else null)
        }
      }
    }

    OnDestroy {
      finishLogin(false)
    }
  }

  private fun settleCharge(promise: Promise, result: ZettleResult?) {
    when (result) {
      is ZettleResult.Completed<*> -> {
        val payload = CardReaderAction.fromPaymentResult(result).payload
        promise.resolve(
          mapOf(
            "status" to "completed",
            "amountMinor" to payload.amount,
            "cardBrand" to payload.cardType,
            // Last four only: the masked number never leaves the native side.
            "cardLast4" to lastFour(payload.maskedPan),
            "entryMode" to payload.cardPaymentEntryMode,
            "transactionId" to payload.transactionId,
          ),
        )
      }
      is ZettleResult.Cancelled -> promise.resolve(mapOf("status" to "canceled"))
      is ZettleResult.Failed -> {
        val reason = (result as? CardPaymentResult.Failed)?.reason ?: result.reason
        // A network failure can land after the bank approved the card: whether money moved is
        // unknown, so it goes to recovery rather than being failed.
        if (reason is CardFailureReason.NetworkError || reason is CardFailureReason.NetworkTimeout) {
          promise.reject(CodedException("ERR_UNCONFIRMED", "The reader lost its connection: ${name(reason)}", null))
        } else {
          promise.resolve(mapOf("status" to "failed", "reason" to describe(reason)))
        }
      }
      // No result at all (the SDK screen was torn down): unknown, never "not charged".
      null -> promise.reject(CodedException("ERR_UNCONFIRMED", "The card reader returned no result", null))
    }
  }

  private fun settleRefund(promise: Promise, result: ZettleResult?) {
    when (result) {
      is ZettleResult.Completed<*> -> {
        val payload = CardReaderAction.fromRefundResult(result).payload
        promise.resolve(mapOf("status" to "completed", "transactionId" to payload.transactionId))
      }
      is ZettleResult.Cancelled -> promise.resolve(mapOf("status" to "canceled"))
      is ZettleResult.Failed -> {
        val reason = (result as? RefundResult.Failed)?.reason ?: result.reason
        promise.resolve(
          mapOf(
            "status" to "failed",
            "reason" to describe(reason),
            "alreadyRefunded" to (reason is RefundFailureReason.AlreadyRefunded),
          ),
        )
      }
      null -> promise.reject(CodedException("ERR_UNCONFIRMED", "The refund screen returned no result", null))
    }
  }

  private fun finishLogin(ok: Boolean) {
    val promise = pendingLogin ?: return
    pendingLogin = null
    loginObserver?.let { observer ->
      if (ZettleSDK.isInitialized) ZettleSDK.instance?.authState?.removeObserver(observer)
    }
    loginObserver = null
    promise.resolve(ok)
  }

  private fun sdk(): ZettleSDK {
    if (!ZettleSDK.isInitialized) {
      throw CodedException("ERR_NOT_CONFIGURED", "PayPal's SDK is not configured", null)
    }
    return ZettleSDK.instance
      ?: throw CodedException("ERR_NOT_CONFIGURED", "PayPal's SDK is not configured", null)
  }

  private fun activity(): Activity =
    appContext.currentActivity
      ?: throw CodedException("ERR_NO_ACTIVITY", "The app is not in the foreground", null)

  private fun lastFour(value: String?): String? =
    value?.filter { it.isDigit() }?.takeLast(4)?.takeIf { it.length == 4 }

  private fun name(reason: Any?): String = reason?.javaClass?.simpleName ?: "Unknown"

  private fun describe(reason: Any?): String =
    (reason as? RefundFailureReason)?.description?.takeIf { it.isNotBlank() } ?: name(reason)

  companion object {
    private const val REQUEST_CHARGE = 47301
    private const val REQUEST_REFUND = 47302
  }
}

class ConfigureOptions : Record {
  @Field val clientId: String = ""
  @Field val redirectUrl: String = ""
  @Field val devMode: Boolean = false
}

class ChargeOptions : Record {
  @Field val amountMinor: Long = 0
  @Field val reference: String = ""
}

class RefundOptions : Record {
  @Field val reference: String = ""
  @Field val amountMinor: Long = 0
  @Field val refundReference: String = ""
}
