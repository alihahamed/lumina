import TextRecognition from '@react-native-ml-kit/text-recognition'

/**
 * Phase 4, the "READING" tier (PRD section 4): on-demand sign and room-number
 * reading, on-device, offline, free. Google ML Kit Text Recognition v2 — chosen in
 * PRD section 5 for Latin + Devanagari support. Not continuous: the user asks for it,
 * unlike detection and haptics which never stop.
 *
 * @param uri A `file://` URI to a still photo. A live VisionCamera frame will not
 * work here — this needs a file, not a frame buffer.
 * @returns The recognised text, trimmed, or '' if nothing was found.
 */
export async function readText(uri: string): Promise<string> {
  const result = await TextRecognition.recognize(uri)
  return result.text.trim()
}
