/**
 * User configuration relevant to a scribe session, fetched once after auth.
 *
 * Mirrors the ScribeMD mobile app's use of GET /api/v1/users/user_data
 * (stores/userStore.ts): the endpoint returns the whole user payload; the
 * SDK only parses the subset that drives session behavior.
 */
import type { AuthorizedFetch } from './encounters';

export type EncounterMode = 'visit' | 'dictation';

export interface NoteTemplateSummary {
  id: string;
  name: string;
}

export interface ScribeUserConfig {
  /** The user's default recording mode (`active_encounter_mode`). */
  activeEncounterMode: EncounterMode;
  /** Whether the user may switch modes before recording (`encounter_modes`). */
  encounterModesEnabled: boolean;
  /** Note templates visible to the user (`note_templates`). */
  noteTemplates: NoteTemplateSummary[];
  /** User default template (`default_note_template_id`), if any. */
  defaultNoteTemplateId: string | null;
}

export async function fetchUserData(authorizedFetch: AuthorizedFetch): Promise<ScribeUserConfig> {
  const response = await authorizedFetch('/api/v1/users/user_data', { method: 'GET' });
  if (!response.ok) {
    throw new Error(`Failed to fetch user data (${response.status})`);
  }
  const data = (await response.json()) as Record<string, unknown>;

  const templatesRaw = Array.isArray(data.note_templates) ? data.note_templates : [];
  const noteTemplates: NoteTemplateSummary[] = templatesRaw
    .filter(
      (template): template is { id: number | string; name: string } =>
        template != null &&
        typeof template === 'object' &&
        'id' in template &&
        'name' in template
    )
    .map((template) => ({ id: String(template.id), name: String(template.name) }));

  return {
    activeEncounterMode: data.active_encounter_mode === 'visit' ? 'visit' : 'dictation',
    encounterModesEnabled: data.encounter_modes === true,
    noteTemplates,
    defaultNoteTemplateId:
      data.default_note_template_id != null ? String(data.default_note_template_id) : null,
  };
}
