import ExpoModulesCore
import iZettleSDK

/// PayPal POS Card Reader, through PayPal's Zettle Payments SDK (docs/card-payments-paypal.md).
/// JS reaches it only through app/src/lib/card-reader.ts, whose `NativePaypalReader` interface this
/// implements. Amounts cross the boundary in minor units (cents); iZettleSDK takes and returns a
/// decimal amount, so the conversion happens here and nowhere else.
///
/// Written from PayPal's example app (iZettle/sdk-ios `Example/`) and the 4.70.4 headers.
///
/// The one rule that shapes every result below: card-payment-flow.ts treats `failed` /
/// `not_found` as "no money moved" and fails the payment on the server. iZettleSDK's documentation
/// does not say how a cancelled charge is reported, so a charge that did not plainly succeed is
/// checked with PayPal (`retrievePaymentInfo`) before it is called cancelled or declined, and if
/// PayPal cannot be asked the promise REJECTS — leaving the payment pending for recovery.
public class PaypalReaderModule: Module {
  private let authObserver = AuthObserver()
  private var started = false

  public func definition() -> ModuleDefinition {
    Name("PaypalReader")

    AsyncFunction("configure") { (opts: ConfigureOptions) in
      // Once per process: JS only calls this again after a failure.
      if self.started { return }
      guard let callback = URL(string: opts.redirectUrl) else {
        throw Exception(name: "ERR_REDIRECT", description: "Invalid PayPal redirect URL")
      }
      let provider = try iZettleSDKAuthorization(clientID: opts.clientId, callbackURL: callback)
      iZettleSDK.shared().authorizationObserver = self.authObserver
      iZettleSDK.shared().start(with: provider, enableDeveloperMode: opts.devMode)
      self.started = true
    }.runOnQueue(.main)

    AsyncFunction("isLoggedIn") { () -> Bool in
      try self.requireStarted()
      return iZettleSDK.shared().isLoggedIn
    }.runOnQueue(.main)

    AsyncFunction("login") { (promise: Promise) in
      try self.requireStarted()
      if iZettleSDK.shared().isLoggedIn {
        promise.resolve(true)
        return
      }
      let vc = try self.presenter()
      iZettleSDK.shared().performLogin(from: vc) { error in
        // A closed sign-in page is an error too; JS only needs to know whether it worked.
        promise.resolve(error == nil && iZettleSDK.shared().isLoggedIn)
      }
    }.runOnQueue(.main)

    AsyncFunction("logout") { () in
      try self.requireStarted()
      iZettleSDK.shared().logout()
      self.authObserver.info = nil
    }.runOnQueue(.main)

    AsyncFunction("account") { () -> [String: Any?]? in
      try self.requireStarted()
      // iZettleSDK has no getter for the signed-in account; it is only handed over at sign-in.
      // A phone that signed in on an earlier launch therefore reports null until the next sign-in,
      // which the Card payments screen already treats as "not known".
      guard iZettleSDK.shared().isLoggedIn, let info = self.authObserver.info else { return nil }
      return [
        "orgRef": info.organizationId,
        "currency": info.currency,
        "country": info.country,
        "name": info.publicName,
      ]
    }.runOnQueue(.main)

    AsyncFunction("openReaderSettings") { () in
      try self.requireStarted()
      // Tipping is always off (client decision 2026-10-15), so its settings are not offered.
      iZettleSDK.shared().presentSettings(
        from: try self.presenter(),
        configuration: IZSDKSettingsConfiguration(paypalReaderTippingSettingsEnabled: false)
      )
    }.runOnQueue(.main)

    AsyncFunction("charge") { (opts: ChargeOptions, promise: Promise) in
      try self.requireStarted()
      let vc = try self.presenter()
      let reference = opts.reference
      iZettleSDK.shared().charge(
        amount: Self.decimal(opts.amountMinor),
        // Tipping is always off (client decision 2026-10-15): the reader charges the bill only.
        tippingConfiguration: IZSDKTippingConfiguration.disabled(),
        reference: reference,
        presentFrom: vc
      ) { info, error in
        if let info {
          promise.resolve(Self.chargeResult(info))
          return
        }
        if let error = error as NSError?, Self.isPreflight(error) {
          // Refused before the reader was used (bad amount, not signed in, ...): nothing taken.
          promise.resolve(["status": "failed", "reason": error.localizedDescription])
          return
        }
        // A cancel, a decline or a dropped connection all look alike from here. Ask PayPal.
        iZettleSDK.shared().retrievePaymentInfo(for: reference) { found, lookupError in
          if let found {
            promise.resolve(Self.chargeResult(found))
          } else if let lookupError = lookupError as NSError?, Self.isNotFound(lookupError) {
            if let error {
              promise.resolve(["status": "failed", "reason": error.localizedDescription])
            } else {
              promise.resolve(["status": "canceled"])
            }
          } else {
            promise.reject(Exception(name: "ERR_UNCONFIRMED", description: "Could not confirm the card payment with PayPal"))
          }
        }
      }
    }.runOnQueue(.main)

    AsyncFunction("retrieve") { (reference: String, promise: Promise) in
      try self.requireStarted()
      iZettleSDK.shared().retrievePaymentInfo(for: reference) { info, error in
        if let info {
          promise.resolve(Self.chargeResult(info))
        } else if let error = error as NSError?, Self.isNotFound(error) {
          promise.resolve(["status": "not_found"])
        } else {
          // Network, auth, anything else: PayPal could not be asked, which is not "not charged".
          promise.reject(Exception(name: "ERR_RETRIEVE", description: "PayPal could not be asked about this payment"))
        }
      }
    }.runOnQueue(.main)

    AsyncFunction("refund") { (opts: RefundOptions, promise: Promise) in
      try self.requireStarted()
      let vc = try self.presenter()
      iZettleSDK.shared().refund(
        amount: Self.decimal(opts.amountMinor),
        ofPayment: opts.reference,
        // Fixed per payment by the JS side, so a retry after a lost answer is the same refund.
        withRefundReference: opts.refundReference,
        presentFrom: vc
      ) { info, error in
        if let info {
          promise.resolve(["status": "completed", "transactionId": info.transactionId])
        } else if let error {
          promise.resolve(["status": "failed", "reason": error.localizedDescription])
        } else {
          promise.resolve(["status": "canceled"])
        }
      }
    }.runOnQueue(.main)
  }

  private func requireStarted() throws {
    if !started {
      throw Exception(name: "ERR_NOT_CONFIGURED", description: "PayPal's SDK is not configured")
    }
  }

  private func presenter() throws -> UIViewController {
    guard let vc = appContext?.utilities?.currentViewController() else {
      throw Exception(name: "ERR_NO_VIEW", description: "Nothing on screen to present PayPal from")
    }
    return vc
  }

  // IZSDKErrorCode (iZettleSDKPaymentInfo.h). Compared as raw values so a renamed Swift import
  // cannot change the meaning.
  private static func isNotFound(_ error: NSError) -> Bool {
    error.domain == IZSDKErrorDomain && error.code == -100
  }

  /// Errors iZettleSDK raises before it ever talks to the reader — the card cannot have been charged.
  private static func isPreflight(_ error: NSError) -> Bool {
    guard error.domain == IZSDKErrorDomain else { return false }
    // UserNotLoggedIn, ReferenceTooLong, ReferenceIsNil, OperationAlreadyInProgress, InvalidAmount,
    // AmountTooLow, AmountTooHigh, DeviceNotSupported, NotEligible, AccountNotLinked,
    // UnableToPresentView. NoNetwork (-406) is left out: it can come after the card was read.
    return [-1, -101, -102, -300, -400, -401, -402, -403, -404, -405, -407].contains(error.code)
  }

  private static func chargeResult(_ info: iZettleSDKPaymentInfo) -> [String: Any?] {
    return [
      "status": "completed",
      "amountMinor": minor(info.amount),
      "cardBrand": info.cardBrand,
      // Last four only: the masked number never leaves the native side.
      "cardLast4": lastFour(info.obfuscatedPan),
      "entryMode": info.entryMode,
      "transactionId": info.transactionId,
    ]
  }

  private static func decimal(_ minor: Int) -> NSDecimalNumber {
    NSDecimalNumber(mantissa: UInt64(max(minor, 0)), exponent: -2, isNegative: false)
  }

  private static func minor(_ amount: NSDecimalNumber) -> Int {
    let handler = NSDecimalNumberHandler(
      roundingMode: .plain, scale: 0, raiseOnExactness: false, raiseOnOverflow: false,
      raiseOnUnderflow: false, raiseOnDivideByZero: false
    )
    return amount.multiplying(byPowerOf10: 2, withBehavior: handler).intValue
  }

  private static func lastFour(_ pan: String?) -> String? {
    guard let digits = pan?.filter(\.isNumber), digits.count >= 4 else { return nil }
    return String(digits.suffix(4))
  }
}

/// iZettleSDK hands over the signed-in account only through this delegate, which it holds weakly.
final class AuthObserver: NSObject, ZettleUserAuthorizationDelegate {
  var info: ZettleUserInfo?

  func userDidLogin(with info: ZettleUserInfo) {
    self.info = info
  }

  func userDidLogout() {
    info = nil
  }
}

struct ConfigureOptions: Record {
  @Field var clientId: String = ""
  @Field var redirectUrl: String = ""
  @Field var devMode: Bool = false
}

struct ChargeOptions: Record {
  @Field var amountMinor: Int = 0
  @Field var reference: String = ""
}

struct RefundOptions: Record {
  @Field var reference: String = ""
  @Field var amountMinor: Int = 0
  @Field var refundReference: String = ""
}
