import type { UploadSource } from '@easylivechat/react-native';

/**
 * A file returned by a host-provided attachment picker
 * (`EasyLiveChatScreen.onPickAttachments`).
 *
 * The SDK uploads `data` with the widget JWT and links the result to the next
 * sent message.
 *
 * `data` is a {@link UploadSource}: prefer a `{ uri }` file reference, which
 * React Native's `FormData` streams straight off disk — a 20 MB video read
 * into a JS `Uint8Array` first is how a picker crashes a mid-range Android
 * phone. Bytes are accepted for hosts that already hold them.
 */
export interface ElcPickedFile {
  data: UploadSource;
  /** File name (with extension) the server should record. */
  filename: string;
  /** MIME type (e.g. `image/jpeg`); the server infers one when omitted. */
  contentType?: string;
}

/**
 * Host hook that fully owns attachment picking (e.g. your app's own
 * camera/gallery sheet). Return the picked files, or an empty array if the
 * user cancelled.
 *
 * When provided, the composer's attach button calls this INSTEAD of the
 * built-in image/document pickers — which is also how a host avoids installing
 * `expo-image-picker` / `expo-document-picker` at all.
 */
export type ElcAttachmentPicker = () => Promise<ElcPickedFile[]>;
