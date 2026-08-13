import React, { useCallback, useMemo, useRef } from 'react';
import { Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import * as Print from 'expo-print';
import QRCode from 'react-native-qrcode-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TText } from '@/components/common';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { useResponsive } from '@/hooks/useResponsive';
import { t, format } from '@/i18n';
import { API_BASE_URL, WEB_BASE_URL } from '@/lib/config';
import { styles } from '@/styles';
import { moderateScale } from '@/styles/scale';
import type { ThemeStyleProps } from '@/styles/types';
import { useAppState } from '@/state/store';
import { useTheme } from '@/theme/ThemeProvider';

/** Ref shape we use from react-native-qrcode-svg's underlying <Svg> (native + web). */
type QrSvgRef = { toDataURL: (cb: (base64: string) => void) => void };

// A print document holding ONLY the QR + name, centered on one page. `@page{margin:0}`
// leaves no room for the browser's auto date/URL/page-number chrome, so it doesn't render.
// `qrMarkup` is ready-to-embed HTML — an inline <svg> (web) or an <img> (native).
function buildPrintHtml(name: string, qrMarkup: string): string {
  const safe = name.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
  return (
    `<!doctype html><html><head><meta charset="utf-8"><title>${safe} booking QR</title>` +
    `<style>@page{margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0;height:100%}` +
    `.wrap{height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:hidden;` +
    `padding:40px;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;text-align:center;color:#111}` +
    `h1{font-size:28px;font-weight:700;margin:0 0 8px}p{font-size:15px;color:#555;margin:0 0 36px}` +
    `svg,img{width:420px;height:420px;max-width:80vw}</style></head>` +
    `<body><div class="wrap"><h1>${safe}</h1><p>${t.qr.subtitle}</p>` +
    `${qrMarkup}</div></body></html>`
  );
}

// Web: expo-print's html option is ignored on web (it prints the current page), so print an
// isolated hidden iframe holding just the QR doc instead — same trick as the admin panel.
function printHtmlViaIframe(html: string) {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow?.document;
  if (!doc) {
    iframe.remove();
    return;
  }
  const cleanup = () => iframe.remove();
  doc.open();
  doc.write(html);
  doc.close();
  const win = iframe.contentWindow;
  if (!win) {
    cleanup();
    return;
  }
  win.onafterprint = cleanup;
  setTimeout(cleanup, 60000);
  win.focus();
  win.print();
}

export function QRSheet() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const store = useAppState();
  const { centerStyle } = useResponsive(520);
  const overlay = useMemo(() => createSheetOverlayStyles(), []);
  const s = useMemo(() => createQRSheetStyles(theme, insets.bottom), [theme, insets.bottom]);
  const qrRef = useRef<QrSvgRef | null>(null);
  const qrBoxRef = useRef<View | null>(null);

  const slug = store.business?.slug;
  const name = store.business?.name || t.qr.storeFallback;
  const phoneFull = `${store.business?.countryCode ?? ''}${store.business?.phoneNumber ?? ''}`;
  // Live vCard endpoint: always reflects the latest details, since the backend rebuilds the
  // .vcf from the current business row. Kept as the fallback target below.
  const vcardUrl = slug ? `${API_BASE_URL}/public/businesses/${slug}/vcard` : null;
  // What the QR actually encodes. Scanning used to jump straight into Add-Contact, which
  // assumed every scan is someone saving the number — most are customers wanting to book. The
  // landing page asks which. Falls back to the raw .vcf for a store with no phone on file.
  const qrValue = phoneFull ? `${WEB_BASE_URL}/${phoneFull}/card` : vcardUrl;

  const onPrint = useCallback(() => {
    if (!qrValue) return;
    if (Platform.OS === 'web') {
      // react-native-svg renders a real DOM <svg> on web; inline it (crisp vector). Its own
      // toDataURL rasterizes through a canvas and comes back blank on web, so avoid that path.
      const el = qrBoxRef.current as unknown as HTMLElement | null;
      const svg = el?.querySelector('svg')?.outerHTML;
      if (!svg) return;
      printHtmlViaIframe(buildPrintHtml(name, svg));
    } else {
      // Native: toDataURL works reliably; embed as an <img> and print via expo-print.
      qrRef.current?.toDataURL((base64) => {
        const html = buildPrintHtml(name, `<img src="data:image/png;base64,${base64}"/>`);
        Print.printAsync({ html }).catch(() => {});
      });
    }
  }, [qrValue, name]);

  return (
    <Modal transparent visible={store.qr} animationType="slide" onRequestClose={store.closeQr}>
      <View style={overlay.root}>
        <Pressable onPress={store.closeQr} style={overlay.backdrop} />
        <View style={[s.sheet, centerStyle]}>
          <View style={s.handle} />
          <TText variant="h4" weight="semibold" align="center">
            {format(t.qr.contactTitle, { name })}
          </TText>
          <TText variant="bodySm" color="textMuted" align="center" style={s.subtitle}>
            {t.qr.subtitle}
          </TText>
          <View ref={qrBoxRef} style={[s.qrBox, qrValue && s.qrBoxActive]}>
            {qrValue ? (
              <QRCode
                value={qrValue}
                size={moderateScale(176)}
                backgroundColor="#ffffff"
                color="#000000"
                getRef={(c: QrSvgRef | null) => {
                  qrRef.current = c;
                }}
              />
            ) : (
              <Icon name="qrCode" size={120} color={theme.colors.textSubtle} />
            )}
          </View>
          <View style={s.actions}>
            <Button variant="primary" fullWidth disabled={!qrValue} onPress={onPrint}>
              {t.qr.print}
            </Button>
          </View>
        </View>
      </View>
    </Modal>
  );
}

export const createSheetOverlayStyles = () =>
  StyleSheet.create({
    root: { ...styles.flex, justifyContent: 'flex-end' },
    backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(15,23,42,0.45)' },
  });

const createQRSheetStyles = ({ colors, radius }: ThemeStyleProps, bottomInset: number) =>
  StyleSheet.create({
    sheet: {
      backgroundColor: colors.surfaceCard,
      borderTopLeftRadius: moderateScale(radius.xl),
      borderTopRightRadius: moderateScale(radius.xl),
      ...styles.ph5,
      paddingTop: moderateScale(18),
      paddingBottom: moderateScale(28) + bottomInset,
    },
    handle: {
      width: moderateScale(40),
      height: moderateScale(4),
      borderRadius: moderateScale(99),
      backgroundColor: colors.borderDefault,
      alignSelf: 'center',
      ...styles.mb4,
    },
    subtitle: { ...styles.mt1 },
    qrBox: {
      width: moderateScale(200),
      height: moderateScale(200),
      alignSelf: 'center',
      ...styles.mv5,
      borderRadius: moderateScale(radius.lg),
      backgroundColor: colors.surfaceSunken,
      borderWidth: moderateScale(1),
      borderColor: colors.borderSubtle,
      ...styles.nonFlexCenter,
    },
    // Solid white behind a real QR so dark-theme viewers still get a scannable contrast.
    qrBoxActive: { backgroundColor: '#ffffff', borderColor: '#ffffff' },
    actions: { ...styles.mt2 },
  });
