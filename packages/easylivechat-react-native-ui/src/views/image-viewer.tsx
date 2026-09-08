import React from 'react';
import {
  Dimensions,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import { DirectionProvider } from '../direction';
import { CloseIcon } from '../icons';
import type { Strings } from '../l10n';
import type { EasyLiveChatTheme } from '../theme';
import { RemoteImage } from './remote-image';

export interface ElcImageViewerProps {
  visible: boolean;
  uri: string | null;
  theme: EasyLiveChatTheme;
  strings: Strings;
  onClose: () => void;
}

/**
 * Full-screen image viewer.
 *
 * Thread thumbnails are cropped and capped, so tapping one has to open the
 * picture somewhere it can actually be read: without this, a screenshot of the
 * very error the visitor is writing in about was unreadable in the thread and
 * there was nothing to do about it.
 *
 * Zoom is a pinch-capable `ScrollView` rather than a gesture library — a
 * fullscreen viewer is not worth making `react-native-gesture-handler` a
 * required peer of a chat SDK.
 */
export function ElcImageViewer({
  visible,
  uri,
  theme,
  strings,
  onClose,
}: ElcImageViewerProps): React.JSX.Element | null {
  if (!visible || uri == null) return null;
  const { width, height } = Dimensions.get('window');

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <DirectionProvider value={theme.direction}>
        <View style={styles.backdrop}>
          <ScrollView
            style={StyleSheet.absoluteFill}
            contentContainerStyle={styles.content}
            maximumZoomScale={4}
            minimumZoomScale={1}
            centerContent
            showsHorizontalScrollIndicator={false}
            showsVerticalScrollIndicator={false}
          >
            <RemoteImage
              uri={uri}
              style={{ width, height: height * 0.8 }}
              contentFit="contain"
              theme={theme}
            />
          </ScrollView>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={strings.t('close')}
            style={[
              styles.close,
              theme.direction === 'rtl' ? { left: 16 } : { right: 16 },
            ]}
            hitSlop={12}
          >
            <CloseIcon color="#FFFFFF" size={22} />
          </Pressable>
        </View>
      </DirectionProvider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.92)' },
  content: { flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
  close: {
    position: 'absolute',
    top: 48,
    // The side is set per-render from the resolved direction. An earlier
    // version pinned it right on the reasoning that a full-bleed overlay has
    // no content flow to mirror — but a dismiss affordance is exactly the kind
    // of control RTL users expect on the other side, and every RTL-aware photo
    // viewer mirrors it.
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
});
