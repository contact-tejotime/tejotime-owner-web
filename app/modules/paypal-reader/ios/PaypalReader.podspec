Pod::Spec.new do |s|
  s.name           = 'PaypalReader'
  s.version        = '0.1.0'
  s.summary        = 'PayPal POS Card Reader for the TejoTime owner app'
  s.description    = 'Wraps PayPal\'s Zettle Payments SDK (iZettleSDK) — docs/card-payments-paypal.md'
  s.license        = 'UNLICENSED'
  s.author         = 'TejoTime'
  s.homepage       = 'https://www.tejotime.com'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  # Public on CocoaPods trunk; no token needed (unlike Android's GitHub Packages).
  s.dependency 'iZettleSDK', '4.70.4'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = '**/*.{h,m,swift}'
end
