/**
 * Rails ActiveStorage direct upload for visit-mode audio segments.
 *
 * Port of the ScribeMD mobile app's services/directUpload.ts:
 *   1. POST /direct_uploads_api {filename, content_type, byte_size, checksum}
 *      -> {signed_id, direct_upload: {url, headers}}
 *   2. PUT the raw bytes to S3 with Content-Type + Content-MD5.
 * The returned signed_id is then referenced in /sync `segments[]`.
 *
 * All requests go through authorizedFetch so the Bearer access token is
 * attached. (Deviation from the app: bytes are PUT to S3 directly rather
 * than round-tripped through base64.)
 */
import CryptoJS from 'crypto-js';

import type { AuthorizedFetch } from './encounters';
import { readFileBytes } from '../storage/fileSystem';

interface DirectUploadInstructions {
  url: string;
  headers?: Record<string, string>;
}

interface DirectUploadResponse {
  signed_id: string;
  direct_upload: DirectUploadInstructions;
}

const SEGMENT_CONTENT_TYPE = 'audio/wav';

/** Base64-encoded 128-bit MD5 digest, as S3 requires for Content-MD5. */
export function md5Base64(bytes: Uint8Array): string {
  const wordArray = CryptoJS.lib.WordArray.create(bytes);
  return CryptoJS.MD5(wordArray).toString(CryptoJS.enc.Base64);
}

async function createDirectUpload(
  authorizedFetch: AuthorizedFetch,
  filename: string,
  byteSize: number,
  checksum: string
): Promise<DirectUploadResponse> {
  const response = await authorizedFetch('/direct_uploads_api', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filename,
      content_type: SEGMENT_CONTENT_TYPE,
      byte_size: byteSize,
      checksum,
    }),
  });
  if (!response.ok) {
    throw new Error(`Direct upload creation failed (${response.status})`);
  }
  const data = (await response.json()) as DirectUploadResponse;
  if (!data.signed_id || !data.direct_upload?.url) {
    throw new Error('Direct upload creation returned no signed_id/url.');
  }
  return data;
}

function putToS3(
  instructions: DirectUploadInstructions,
  bytes: Uint8Array,
  checksum: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', instructions.url);
    const headers: Record<string, string | undefined> = {
      'Content-Type': SEGMENT_CONTENT_TYPE,
      'Content-MD5': checksum,
      ...instructions.headers,
    };
    for (const [key, headerValue] of Object.entries(headers)) {
      if (headerValue) xhr.setRequestHeader(key, String(headerValue));
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Segment upload failed with status ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error('Segment upload failed'));
    xhr.ontimeout = () => reject(new Error('Segment upload timed out'));
    xhr.send(bytes.buffer as ArrayBuffer);
  });
}

/**
 * Repair a zero-size WAV header in place. If the recorder process died
 * before finalizing the header (Android writes real sizes only at stop),
 * the RIFF/data chunk sizes are still the placeholder 0 — decoders would
 * read 0 samples from an otherwise intact recording. Standard 44-byte
 * PCM header: bytes 4-7 = file size - 8, bytes 40-43 = data size.
 */
function repairWavHeader(bytes: Uint8Array): void {
  if (bytes.length < 44) return;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const isRiff = view.getUint32(0, false) === 0x52494646; // 'RIFF'
  const hasDataChunk = view.getUint32(36, false) === 0x64617461; // 'data'
  if (!isRiff || !hasDataChunk) return;
  if (view.getUint32(40, true) === 0) {
    view.setUint32(4, bytes.length - 8, true);
    view.setUint32(40, bytes.length - 44, true);
  }
}

/**
 * Upload one segment WAV file; resolves with the ActiveStorage signed_id.
 */
export async function uploadSegmentFile(
  authorizedFetch: AuthorizedFetch,
  fileUri: string
): Promise<string> {
  const bytes = await readFileBytes(fileUri);
  if (bytes.length <= 44) {
    throw new Error(`Segment file is empty: ${fileUri}`);
  }
  repairWavHeader(bytes);
  const checksum = md5Base64(bytes);
  const filename = fileUri.split('/').pop() ?? 'segment.wav';
  const { signed_id, direct_upload } = await createDirectUpload(
    authorizedFetch,
    filename,
    bytes.length,
    checksum
  );
  await putToS3(direct_upload, bytes, checksum);
  return signed_id;
}
