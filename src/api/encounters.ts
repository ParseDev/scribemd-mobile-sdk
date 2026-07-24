/**
 * Minimal REST client for the ScribeMD encounters API.
 *
 * Mirrors the exact flows the ScribeMD mobile app uses:
 *   POST /api/v1/encounters      -> create a draft encounter before recording
 *   PUT  /api/v1/encounters/:id  -> finalize the transcript; the backend then
 *                                   generates the clinical note asynchronously
 *   GET  /api/v1/encounters/:id  -> poll note generation status/content
 */

/** `authorizedFetch` from ScribeMDProvider (adds the Bearer token). */
export type AuthorizedFetch = (path: string, init?: RequestInit) => Promise<Response>;

/** Patient identifiers stored on the encounter as `context_data`. */
export interface EncounterPatientContext {
  patientId?: string;
  medicalRecord?: string;
  timestamp?: string;
}

export type EncounterMode = 'visit' | 'dictation';

export interface CreateEncounterOptions {
  /** Recording mode. Default: 'dictation' (live streaming). */
  encounterMode?: EncounterMode;
  /** Transcription language code (e.g. 'en'). */
  language?: string;
  /** Stored server-side as context_data for later encounter lookup. */
  patientContext?: EncounterPatientContext;
  /** Note template driving generation (falls back to user/org default). */
  noteTemplateId?: string;
  /** Free-text context, stored as current_notes_text (app parity). */
  contextNotes?: string;
}

/** The generated clinical note in every representation the API returns. */
export interface GeneratedNote {
  /** Markdown note (markdown-format templates). */
  markdown?: string;
  /** Sectioned note, e.g. { '1_Subjective': '...', '2_Objective': [...] }. */
  json?: { [section: string]: string | string[] };
  /** Plain-text rendering of the note. */
  plain?: string;
}

/** Subset of GET /api/v1/encounters/:id needed to track note generation. */
export interface EncounterSnapshot {
  id: string;
  status?: string;
  /** 'waiting' | 'running' | 'processing' | 'finished' | 'failed' */
  summaryStatus?: string;
  noteFormat?: string;
  jsonNotes?: { [section: string]: string | string[] };
  markdownContent?: string;
  summaryPlain?: string;
  summaryMarkdown?: string;
  /** Server-side transcript (visit mode: produced by batch transcription). */
  customConversation?: string;
}

/** platform_source recorded on encounters created by this SDK. */
const PLATFORM_SOURCE = 'sdk_react_native';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

/**
 * Create a draft encounter. Returns the encounter id, which is also passed to
 * the STT WebSocket (`encounter_id` query param) so audio is attributed to
 * the encounter from the first chunk.
 */
export async function createEncounter(
  authorizedFetch: AuthorizedFetch,
  options: CreateEncounterOptions = {}
): Promise<string> {
  const prompt: Record<string, unknown> = {
    platform_source: PLATFORM_SOURCE,
    encounter_mode: options.encounterMode ?? 'dictation',
    // Send the explicit string 'null'. This SDK is not a registered push
    // device, and the API expects an explicit value here rather than an
    // omitted field.
    device: 'null',
  };
  if (options.language) {
    prompt.language = options.language;
  }
  if (options.noteTemplateId) {
    prompt.note_template_id = options.noteTemplateId;
  }
  if (options.contextNotes && options.contextNotes.trim().length > 0) {
    prompt.current_notes_text = options.contextNotes;
  }

  // Patient identifiers are stored on the encounter as `context_data`
  // for later lookup from the host EHR.
  const context = options.patientContext;
  if (context) {
    const contextData: Record<string, string> = {};
    if (context.patientId != null) contextData.patient_id = context.patientId;
    if (context.medicalRecord != null) contextData.medical_record = context.medicalRecord;
    if (context.timestamp != null) contextData.timestamp = context.timestamp;
    if (Object.keys(contextData).length > 0) {
      prompt.context_data = contextData;
    }
  }

  const response = await authorizedFetch('/api/v1/encounters', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ prompt }),
  });
  if (!response.ok) {
    throw new Error(`Failed to create encounter (${response.status})`);
  }
  const data = (await response.json()) as { encounter_id?: number | string; id?: number | string };
  const id = data.encounter_id ?? data.id;
  if (id == null) {
    throw new Error('Encounter creation returned no encounter id.');
  }
  return String(id);
}

export interface FinalizeEncounterOptions {
  /** Recording mode; decides which server pipeline the finalize triggers. */
  mode: EncounterMode;
  /** Full final transcript (plain text). Empty for visit mode. */
  transcript: string;
  /** JSON string map {id: {text, speaker, start_time}} (app parity). */
  transcriptionData?: string;
  /** Recording duration in seconds. */
  durationSeconds?: number;
  /**
   * Visit mode: signed_ids of the uploaded segments, in order. Sent as
   * prompt[segment_keys][] for app parity — the backend takes the audio from
   * the segments already attached via /sync and ignores this field.
   */
  segmentKeys?: string[];
}

/**
 * Finalize the encounter — the single call that triggers note generation.
 *
 * Dictation: stores the live transcript, then the note is generated from it.
 * Visit: prompt[platform_source]=upload_mobile tells the backend to batch-
 * transcribe the previously uploaded audio segments, then generate the note.
 *
 * Sent as JSON (the SDK attaches no audio file). This also avoids a
 * React Native 0.85/Hermes crash where fetch + FormData references the
 * missing ReadableStream global.
 */
export async function finalizeEncounter(
  authorizedFetch: AuthorizedFetch,
  encounterId: string,
  options: FinalizeEncounterOptions
): Promise<void> {
  const prompt: Record<string, unknown> = {
    custom_conversation: options.transcript,
    end_time: new Date().toISOString(),
    is_offline_recorded: 'false',
  };
  if (options.transcriptionData) {
    prompt.transcription_data = options.transcriptionData;
  }
  if (options.durationSeconds != null && options.durationSeconds > 0) {
    prompt.duration = String(Math.round(options.durationSeconds));
  }
  if (options.mode === 'visit') {
    // Routes the update into the server-side batch transcription pipeline.
    prompt.platform_source = 'upload_mobile';
    prompt.segment_keys = options.segmentKeys ?? [];
  }

  const response = await authorizedFetch(`/api/v1/encounters/${encounterId}`, {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify({ prompt }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Failed to finalize encounter (${response.status}): ${body.slice(0, 300)}`);
  }
}

/**
 * Persist doctor edits to the generated note (the in-SDK review step).
 * POST /:id/update_notes — markdown-format notes send prompt[markdown_content],
 * sectioned notes send prompt[json_notes] as a JSON string.
 */
export async function updateNotes(
  authorizedFetch: AuthorizedFetch,
  encounterId: string,
  note: GeneratedNote
): Promise<void> {
  const prompt: Record<string, unknown> = {};
  if (note.json && Object.keys(note.json).length > 0) {
    prompt.json_notes = JSON.stringify(note.json);
  } else if (note.markdown) {
    prompt.markdown_content = note.markdown;
  } else {
    return;
  }
  const response = await authorizedFetch(`/api/v1/encounters/${encounterId}/update_notes`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ prompt }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Failed to save note edits (${response.status}): ${body.slice(0, 200)}`);
  }
}

/** Fetch the encounter's note generation status + note content. */
export async function getEncounter(
  authorizedFetch: AuthorizedFetch,
  encounterId: string
): Promise<EncounterSnapshot> {
  const response = await authorizedFetch(`/api/v1/encounters/${encounterId}`, {
    method: 'GET',
    headers: JSON_HEADERS,
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch encounter (${response.status})`);
  }
  const data = (await response.json()) as Record<string, unknown>;
  return {
    id: String(data.id ?? encounterId),
    status: typeof data.status === 'string' ? data.status : undefined,
    summaryStatus: typeof data.summary_status === 'string' ? data.summary_status : undefined,
    noteFormat: typeof data.note_format === 'string' ? data.note_format : undefined,
    jsonNotes:
      data.json_notes && typeof data.json_notes === 'object'
        ? (data.json_notes as EncounterSnapshot['jsonNotes'])
        : undefined,
    markdownContent: typeof data.markdown_content === 'string' ? data.markdown_content : undefined,
    customConversation:
      typeof data.custom_conversation === 'string' ? data.custom_conversation : undefined,
    summaryPlain: typeof data.get_summary_plain === 'string' ? data.get_summary_plain : undefined,
    summaryMarkdown:
      typeof data.get_summary_markdown === 'string' ? data.get_summary_markdown : undefined,
  };
}

/** Build a GeneratedNote from a finished encounter; null when empty. */
export function extractGeneratedNote(snapshot: EncounterSnapshot): GeneratedNote | null {
  const note: GeneratedNote = {};
  const markdown = snapshot.markdownContent || snapshot.summaryMarkdown;
  if (markdown && markdown.trim().length > 0) {
    note.markdown = markdown;
  }
  // Markdown-format templates: json_notes carries generator noise (the web
  // app ignores it too) — the markdown IS the note.
  const isMarkdownFormat = snapshot.noteFormat === 'markdown' && note.markdown != null;
  if (!isMarkdownFormat && snapshot.jsonNotes && Object.keys(snapshot.jsonNotes).length > 0) {
    note.json = snapshot.jsonNotes;
  }
  if (snapshot.summaryPlain && snapshot.summaryPlain.trim().length > 0) {
    note.plain = snapshot.summaryPlain;
  }
  return note.markdown || note.json || note.plain ? note : null;
}
