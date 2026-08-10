import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';

import { TText } from '@/components/common';
import { t } from '@/i18n';
import { WEB_BASE_URL } from '@/lib/config';
import { styles } from '@/styles';
import { moderateScale } from '@/styles/scale';
import type { ThemeStyleProps } from '@/styles/types';
import { useTheme } from '@/theme/ThemeProvider';
import type { ThemeConfig } from '@/theme/engine';

const HANDSHAKE_TIMEOUT_MS = 9000;
const POST_DEBOUNCE_MS = 80;
const PREVIEW_H = 420;

type WebViewComponent = React.ComponentType<{
  ref?: React.Ref<any>;
  source: { uri: string };
  style?: object;
  onMessage?: (e: { nativeEvent: { data: string } }) => void;
  onError?: () => void;
  onHttpError?: () => void;
  onLoadEnd?: () => void;
  startInLoadingState?: boolean;
  renderLoading?: () => React.ReactElement;
  nestedScrollEnabled?: boolean;
  setSupportMultipleWindows?: boolean;
  allowsBackForwardNavigationGestures?: boolean;
  originWhitelist?: string[];
  injectJavaScript?: (js: string) => void;
}>;

/**
 * `react-native-webview` is a native module. A static import crashes any binary built before
 * the dependency was added. Resolve once behind try/catch and fall back to an open-site card.
 */
const WebView: WebViewComponent | null = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('react-native-webview').WebView as WebViewComponent;
  } catch {
    return null;
  }
})();

type Props = {
  config: ThemeConfig;
  /** Digits-only country code + national number. */
  phoneFull: string;
};

function previewUrl(phoneFull: string): { src: string; isRealStore: boolean } {
  const base = WEB_BASE_URL.replace(/\/+$/, '');
  const isRealStore = /^\d{7,15}$/.test(phoneFull);
  return {
    isRealStore,
    src: `${base}/${isRealStore ? phoneFull : 'demo-store'}?preview=1`,
  };
}

/**
 * Live preview of the real customer microsite inside a WebView when the native module is
 * present; otherwise a non-crashing fallback with “open site”.
 */
export function MicrositePreview({ config, phoneFull }: Props) {
  const theme = useTheme();
  const s = useMemo(() => createStyles(theme), [theme]);
  const { src, isRealStore } = useMemo(() => previewUrl(phoneFull), [phoneFull]);

  if (!WebView) {
    return (
      <View style={s.root}>
        <TText variant="bodySm" weight="bold" color="textStrong">
          {t.appearance.previewTitle}
        </TText>
        <View style={s.frame}>
          <View style={s.fallback}>
            <TText variant="bodySm" color="textMuted" align="center">
              {t.appearance.previewNeedsRebuild}
            </TText>
            <Pressable
              onPress={() => {
                void Linking.openURL(src.replace(/\?preview=1$/, '') || src);
              }}
              hitSlop={8}
            >
              <TText variant="caption" weight="semibold" color="textStrong">
                {t.appearance.openSite}
              </TText>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  return (
    <LiveWebPreview
      WebView={WebView}
      config={config}
      src={src}
      isRealStore={isRealStore}
      styles={s}
    />
  );
}

function LiveWebPreview({
  WebView: WV,
  config,
  src,
  isRealStore,
  styles: s,
}: {
  WebView: WebViewComponent;
  config: ThemeConfig;
  src: string;
  isRealStore: boolean;
  styles: ReturnType<typeof createStyles>;
}) {
  const webRef = useRef<{ injectJavaScript?: (js: string) => void } | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [stalled, setStalled] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const pushConfig = useCallback(() => {
    if (!ready) return;
    const payload = JSON.stringify(config);
    webRef.current?.injectJavaScript?.(
      `(function(){try{if(typeof window.__ttThemePreview==='function'){window.__ttThemePreview(${payload});}else{window.dispatchEvent(new MessageEvent('message',{data:{type:'tt-theme-preview',config:${payload}},origin:window.location.origin}));}}catch(e){}true;})();`,
    );
  }, [ready, config]);

  const configKey = JSON.stringify(config);
  useEffect(() => {
    if (!ready) return;
    const id = setTimeout(pushConfig, POST_DEBOUNCE_MS);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, configKey]);

  useEffect(() => {
    if (ready || failed) return;
    const id = setTimeout(() => setStalled(true), HANDSHAKE_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [ready, failed, reloadKey]);

  const reload = () => {
    setReady(false);
    setFailed(false);
    setStalled(false);
    setReloadKey((k) => k + 1);
  };

  const status = ready
    ? t.appearance.previewHint
    : stalled
      ? t.appearance.previewNotResponding
      : t.appearance.previewLoading;

  return (
    <View style={s.root}>
      <View style={s.head}>
        <TText variant="bodySm" weight="bold" color="textStrong">
          {t.appearance.previewTitle}
        </TText>
        <Pressable onPress={reload} hitSlop={8}>
          <TText variant="caption" weight="semibold" color="textStrong">
            {t.appearance.previewReload}
          </TText>
        </Pressable>
      </View>

      {!isRealStore ? (
        <TText variant="caption" color="textMuted">
          {t.appearance.previewDemo}
        </TText>
      ) : null}

      <View style={s.frame}>
        {failed ? (
          <View style={s.fallback}>
            <TText variant="bodySm" color="textMuted" align="center">
              {t.appearance.previewUnavailable}
            </TText>
            <Pressable onPress={reload} hitSlop={8}>
              <TText variant="caption" weight="semibold" color="textStrong">
                {t.appearance.previewReload}
              </TText>
            </Pressable>
          </View>
        ) : (
          <>
            <WV
              key={`${src}#${reloadKey}`}
              ref={webRef}
              source={{ uri: src }}
              style={s.web}
              onMessage={(e) => {
                try {
                  const data = JSON.parse(e.nativeEvent.data) as { type?: string };
                  if (data?.type === 'tt-theme-ready') {
                    setReady(true);
                    setStalled(false);
                    setFailed(false);
                  }
                } catch {
                  /* ignore */
                }
              }}
              onError={() => setFailed(true)}
              onHttpError={() => setFailed(true)}
              onLoadEnd={() => {
                if (ready) pushConfig();
              }}
              startInLoadingState
              renderLoading={() => (
                <View style={s.loading}>
                  <ActivityIndicator />
                </View>
              )}
              nestedScrollEnabled
              setSupportMultipleWindows={false}
              allowsBackForwardNavigationGestures={false}
              originWhitelist={['http://*', 'https://*']}
            />
            {!ready && !stalled ? (
              <View style={s.loadingOverlay} pointerEvents="none">
                <ActivityIndicator />
              </View>
            ) : null}
          </>
        )}
      </View>

      <TText variant="caption" color="textMuted">
        {status}
      </TText>
    </View>
  );
}

const createStyles = ({ colors, radius }: ThemeStyleProps) =>
  StyleSheet.create({
    root: { ...styles.g2, marginBottom: moderateScale(16) },
    head: { ...styles.flexRow, ...styles.itemsCenter, ...styles.justifyBetween },
    frame: {
      height: moderateScale(PREVIEW_H),
      borderRadius: moderateScale(radius.lg),
      overflow: 'hidden',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.borderSubtle,
      backgroundColor: colors.surfaceSunken,
    },
    web: { flex: 1, backgroundColor: colors.surfaceSunken },
    loading: {
      ...StyleSheet.absoluteFill,
      ...styles.itemsCenter,
      ...styles.justifyCenter,
      backgroundColor: colors.surfaceSunken,
    },
    loadingOverlay: {
      ...StyleSheet.absoluteFill,
      ...styles.itemsCenter,
      ...styles.justifyCenter,
      backgroundColor: 'transparent',
    },
    fallback: {
      flex: 1,
      ...styles.itemsCenter,
      ...styles.justifyCenter,
      ...styles.g3,
      ...styles.p4,
    },
  });
