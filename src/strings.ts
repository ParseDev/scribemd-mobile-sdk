/**
 * All user-facing copy for the SDK lives here so hosts can localize it.
 *
 * Built-in locales: English (default) and Hebrew. <ScribeSession> applies the
 * locale matching the provider `language` automatically via `applyLanguage`.
 * Call `setStrings({...})` to override any value from the host's own i18n
 * layer — host overrides always win over the built-in locales.
 */

const englishStrings = {
  sessionTitle: 'Untitled encounter',
  patientLabel: 'Patient',
  medicalRecordLabel: 'MRN',
  timestampLabel: 'Date',

  statusConnecting: 'Connecting',
  statusListening: 'Listening',
  statusPaused: 'Paused',
  statusReconnecting: 'Reconnecting',
  statusFinalizing: 'Finalizing',
  statusGenerating: 'Generating note',

  startRecording: 'Start recording',
  idleHint: 'Tap the microphone to start recording.',
  connectingHint: 'Setting up secure transcription…',
  pause: 'Pause',
  resume: 'Resume',
  stop: 'Stop',
  slideToFinish: 'Slide to finish',
  cancel: 'Cancel',
  discardTitle: 'Discard this recording?',
  discardMessage: 'The audio captured so far will be deleted.',
  discardConfirm: 'Discard',
  discardKeep: 'Keep recording',
  closeTitle: 'Close this encounter?',
  closeConfirm: 'Close',
  closeKeep: 'Stay',
  dismiss: 'Dismiss',

  modeVisit: 'Transcribe',
  modeDictate: 'Dictate',
  templateLabel: 'Template',
  selectTemplate: 'Select template',
  chooseTemplate: 'Choose a template…',
  searchTemplates: 'Search templates…',
  addContext: 'Add context',
  addContextPlaceholder: 'Add any additional notes or context…',
  done: 'Done',

  transcriptTitle: 'Live transcript',
  transcriptEmpty: 'Listening…',

  stageSavingTranscript: 'Saving transcript',
  stageUploading: 'Uploading audio',
  stageTranscribing: 'Transcribing the visit',
  stageGenerating: 'Generating note',
  reviewNoteTitle: 'Review note',
  approveNote: 'Approve & send',
  savingNote: 'Saving…',
  recordingVisitHint: 'Recording the visit…',
  finalizingHint: 'Wrapping up the last few words…',
  uploadingHint: 'Uploading the recording…',
  transcribingHint: 'Transcribing the visit…',
  generatingHint: 'Generating clinical note…',
  generatingStreamingHint: 'Receiving the note from ScribeMD…',
  sessionComplete: 'Session complete.',

  setupRequiredTitle: 'Setup required',
  setupRequiredMessage: 'A ScribeMD session token is required to start. Provide one via the ScribeMDProvider before opening a session.',
  openSettings: 'Open settings',

  errorTitle: 'Something went wrong',
  retry: 'Try again',
  errorAuthNotReady: 'Not authenticated yet. Check the ScribeMDProvider configuration.',
  errorAuthFailed: 'Authentication with ScribeMD failed.',
  errorConnectionFailed: 'Could not connect to the transcription service.',
  errorConnectionLost: 'Connection to the transcription service was lost.',
  errorMicrophone: 'The microphone could not be started. Check microphone permissions.',
  errorNoteGeneration: 'The note could not be generated. Your transcript is safe.',
  errorNoteSave: 'Your edits could not be saved to ScribeMD, but the note was delivered.',
  errorSegmentUpload: 'Some audio failed to upload; it will be retried.',
  errorSegmentLimit: 'Maximum recording length reached. Please stop the session.',

  poweredBy: 'Powered by ScribeMD',
};

export type ScribeStrings = { [K in keyof typeof englishStrings]: string };

const hebrewStrings: ScribeStrings = {
  sessionTitle: 'מפגש ללא שם',
  patientLabel: 'מטופל',
  medicalRecordLabel: 'מספר תיק',
  timestampLabel: 'תאריך',

  statusConnecting: 'מתחבר',
  statusListening: 'מאזין',
  statusPaused: 'מושהה',
  statusReconnecting: 'מתחבר מחדש',
  statusFinalizing: 'מסכם',
  statusGenerating: 'יוצר סיכום',

  startRecording: 'התחל הקלטה',
  idleHint: 'הקש על המיקרופון כדי להתחיל בהקלטה.',
  connectingHint: 'מגדיר תמלול מאובטח…',
  pause: 'השהה',
  resume: 'המשך',
  stop: 'עצור',
  slideToFinish: 'החלק לסיום',
  cancel: 'ביטול',
  discardTitle: 'למחוק את ההקלטה?',
  discardMessage: 'השמע שהוקלט עד כה יימחק.',
  discardConfirm: 'מחק',
  discardKeep: 'המשך הקלטה',
  closeTitle: 'לסגור את המפגש?',
  closeConfirm: 'סגור',
  closeKeep: 'הישאר',
  dismiss: 'סגור',

  modeVisit: 'תמלול',
  modeDictate: 'הכתבה',
  templateLabel: 'תבנית',
  selectTemplate: 'בחר תבנית',
  chooseTemplate: 'בחר תבנית…',
  searchTemplates: 'חפש תבניות…',
  addContext: 'הוסף הקשר',
  addContextPlaceholder: 'הוסף הערות או הקשר נוסף…',
  done: 'סיום',

  transcriptTitle: 'תמלול חי',
  transcriptEmpty: 'מאזין…',

  stageSavingTranscript: 'שומר תמלול',
  stageUploading: 'מעלה שמע',
  stageTranscribing: 'מתמלל את המפגש',
  stageGenerating: 'יוצר סיכום',
  reviewNoteTitle: 'סקירת סיכום',
  approveNote: 'אשר ושלח',
  savingNote: 'שומר…',
  recordingVisitHint: 'מקליט את המפגש…',
  finalizingHint: 'משלים את המילים האחרונות…',
  uploadingHint: 'מעלה את ההקלטה…',
  transcribingHint: 'מתמלל את המפגש…',
  generatingHint: 'יוצר סיכום קליני…',
  generatingStreamingHint: 'מקבל את הסיכום מ-ScribeMD…',
  sessionComplete: 'המפגש הסתיים.',

  setupRequiredTitle: 'נדרשת הגדרה',
  setupRequiredMessage: 'נדרש אסימון גישה כדי להתחיל. ספק אותו דרך ScribeMDProvider לפני פתיחת מפגש.',
  openSettings: 'פתח הגדרות',

  errorTitle: 'משהו השתבש',
  retry: 'נסה שוב',
  errorAuthNotReady: 'טרם בוצע אימות. בדוק את הגדרות ScribeMDProvider.',
  errorAuthFailed: 'האימות מול ScribeMD נכשל.',
  errorConnectionFailed: 'לא ניתן להתחבר לשירות התמלול.',
  errorConnectionLost: 'החיבור לשירות התמלול אבד.',
  errorMicrophone: 'לא ניתן להפעיל את המיקרופון. בדוק את הרשאות המיקרופון.',
  errorNoteGeneration: 'יצירת הסיכום נכשלה. התמלול נשמר.',
  errorNoteSave: 'העריכות לא נשמרו ב-ScribeMD, אך הסיכום נמסר.',
  errorSegmentUpload: 'חלק מההקלטה לא הועלה; ננסה שוב.',
  errorSegmentLimit: 'אורך ההקלטה המרבי הושג. אנא עצור את המפגש.',

  poweredBy: 'מופעל על ידי ScribeMD',
};

const arabicStrings: ScribeStrings = {
  sessionTitle: 'مقابلة بدون عنوان',
  patientLabel: 'المريض',
  medicalRecordLabel: 'رقم الملف',
  timestampLabel: 'التاريخ',

  statusConnecting: 'جارٍ الاتصال',
  statusListening: 'يستمع',
  statusPaused: 'متوقف مؤقتاً',
  statusReconnecting: 'إعادة الاتصال',
  statusFinalizing: 'جارٍ الإنهاء',
  statusGenerating: 'إنشاء الملاحظة',

  startRecording: 'ابدأ التسجيل',
  idleHint: 'اضغط على الميكروفون لبدء التسجيل.',
  connectingHint: 'جارٍ إعداد النسخ الآمن…',
  pause: 'إيقاف مؤقت',
  resume: 'استئناف',
  stop: 'إيقاف',
  slideToFinish: 'اسحب للإنهاء',
  cancel: 'إلغاء',
  discardTitle: 'حذف هذا التسجيل؟',
  discardMessage: 'سيتم حذف الصوت المسجل حتى الآن.',
  discardConfirm: 'حذف',
  discardKeep: 'متابعة التسجيل',
  closeTitle: 'إغلاق هذه المقابلة؟',
  closeConfirm: 'إغلاق',
  closeKeep: 'البقاء',
  dismiss: 'إغلاق',

  modeVisit: 'نسخ',
  modeDictate: 'إملاء',
  templateLabel: 'القالب',
  selectTemplate: 'اختر القالب',
  chooseTemplate: 'اختر قالباً…',
  searchTemplates: 'ابحث في القوالب…',
  addContext: 'أضف سياقاً',
  addContextPlaceholder: 'أضف أي ملاحظات أو سياق إضافي…',
  done: 'تم',

  transcriptTitle: 'النسخ المباشر',
  transcriptEmpty: 'يستمع…',

  stageSavingTranscript: 'حفظ النص',
  stageUploading: 'رفع الصوت',
  stageTranscribing: 'نسخ المقابلة',
  stageGenerating: 'إنشاء الملاحظة',
  reviewNoteTitle: 'مراجعة الملاحظة',
  approveNote: 'اعتماد وإرسال',
  savingNote: 'جارٍ الحفظ…',
  recordingVisitHint: 'جارٍ تسجيل المقابلة…',
  finalizingHint: 'إكمال الكلمات الأخيرة…',
  uploadingHint: 'جارٍ رفع التسجيل…',
  transcribingHint: 'جارٍ نسخ المقابلة…',
  generatingHint: 'إنشاء الملاحظة السريرية…',
  generatingStreamingHint: 'استلام الملاحظة من ScribeMD…',
  sessionComplete: 'اكتملت الجلسة.',

  setupRequiredTitle: 'الإعداد مطلوب',
  setupRequiredMessage: 'يلزم رمز جلسة للبدء. قدّمه عبر ScribeMDProvider قبل فتح جلسة.',
  openSettings: 'فتح الإعدادات',

  errorTitle: 'حدث خطأ ما',
  retry: 'حاول مرة أخرى',
  errorAuthNotReady: 'لم تتم المصادقة بعد. تحقق من إعدادات ScribeMDProvider.',
  errorAuthFailed: 'فشلت المصادقة مع ScribeMD.',
  errorConnectionFailed: 'تعذر الاتصال بخدمة النسخ.',
  errorConnectionLost: 'انقطع الاتصال بخدمة النسخ.',
  errorMicrophone: 'تعذر تشغيل الميكروفون. تحقق من أذونات الميكروفون.',
  errorNoteGeneration: 'تعذر إنشاء الملاحظة. النص محفوظ.',
  errorNoteSave: 'تعذر حفظ التعديلات في ScribeMD، لكن الملاحظة سُلّمت.',
  errorSegmentUpload: 'فشل رفع جزء من الصوت؛ ستتم إعادة المحاولة.',
  errorSegmentLimit: 'تم بلوغ الحد الأقصى لمدة التسجيل. يرجى إيقاف الجلسة.',

  poweredBy: 'مدعوم من ScribeMD',
};

const frenchStrings: ScribeStrings = {
  sessionTitle: 'Consultation sans titre',
  patientLabel: 'Patient',
  medicalRecordLabel: 'Dossier',
  timestampLabel: 'Date',

  statusConnecting: 'Connexion',
  statusListening: 'À l’écoute',
  statusPaused: 'En pause',
  statusReconnecting: 'Reconnexion',
  statusFinalizing: 'Finalisation',
  statusGenerating: 'Génération de la note',

  startRecording: 'Démarrer l’enregistrement',
  idleHint: 'Appuyez sur le micro pour commencer l’enregistrement.',
  connectingHint: 'Préparation de la transcription sécurisée…',
  pause: 'Pause',
  resume: 'Reprendre',
  stop: 'Arrêter',
  slideToFinish: 'Glissez pour terminer',
  cancel: 'Annuler',
  discardTitle: 'Supprimer cet enregistrement ?',
  discardMessage: 'L’audio capturé jusqu’ici sera supprimé.',
  discardConfirm: 'Supprimer',
  discardKeep: 'Continuer l’enregistrement',
  closeTitle: 'Fermer cette consultation ?',
  closeConfirm: 'Fermer',
  closeKeep: 'Rester',
  dismiss: 'Fermer',

  modeVisit: 'Transcrire',
  modeDictate: 'Dicter',
  templateLabel: 'Modèle',
  selectTemplate: 'Sélectionner un modèle',
  chooseTemplate: 'Choisir un modèle…',
  searchTemplates: 'Rechercher des modèles…',
  addContext: 'Ajouter du contexte',
  addContextPlaceholder: 'Ajoutez des notes ou du contexte supplémentaire…',
  done: 'Terminé',

  transcriptTitle: 'Transcription en direct',
  transcriptEmpty: 'À l’écoute…',

  stageSavingTranscript: 'Enregistrement de la transcription',
  stageUploading: 'Envoi de l’audio',
  stageTranscribing: 'Transcription de la consultation',
  stageGenerating: 'Génération de la note',
  reviewNoteTitle: 'Relire la note',
  approveNote: 'Approuver et envoyer',
  savingNote: 'Enregistrement…',
  recordingVisitHint: 'Enregistrement de la consultation…',
  finalizingHint: 'Finalisation des derniers mots…',
  uploadingHint: 'Envoi de l’enregistrement…',
  transcribingHint: 'Transcription de la consultation…',
  generatingHint: 'Génération de la note clinique…',
  generatingStreamingHint: 'Réception de la note depuis ScribeMD…',
  sessionComplete: 'Session terminée.',

  setupRequiredTitle: 'Configuration requise',
  setupRequiredMessage: 'Un jeton de session est requis pour démarrer. Fournissez-le via ScribeMDProvider avant d’ouvrir une session.',
  openSettings: 'Ouvrir les réglages',

  errorTitle: 'Un problème est survenu',
  retry: 'Réessayer',
  errorAuthNotReady: 'Non authentifié. Vérifiez la configuration de ScribeMDProvider.',
  errorAuthFailed: 'Échec de l’authentification auprès de ScribeMD.',
  errorConnectionFailed: 'Impossible de se connecter au service de transcription.',
  errorConnectionLost: 'Connexion au service de transcription perdue.',
  errorMicrophone: 'Impossible de démarrer le micro. Vérifiez les autorisations.',
  errorNoteGeneration: 'La note n’a pas pu être générée. Votre transcription est sauvegardée.',
  errorNoteSave: 'Vos modifications n’ont pas pu être enregistrées dans ScribeMD, mais la note a été transmise.',
  errorSegmentUpload: 'Une partie de l’audio n’a pas pu être envoyée ; nouvel essai à venir.',
  errorSegmentLimit: 'Durée maximale d’enregistrement atteinte. Veuillez arrêter la session.',

  poweredBy: 'Propulsé par ScribeMD',
};

const spanishStrings: ScribeStrings = {
  sessionTitle: 'Consulta sin título',
  patientLabel: 'Paciente',
  medicalRecordLabel: 'Historia',
  timestampLabel: 'Fecha',

  statusConnecting: 'Conectando',
  statusListening: 'Escuchando',
  statusPaused: 'En pausa',
  statusReconnecting: 'Reconectando',
  statusFinalizing: 'Finalizando',
  statusGenerating: 'Generando nota',

  startRecording: 'Iniciar grabación',
  idleHint: 'Toca el micrófono para comenzar a grabar.',
  connectingHint: 'Preparando la transcripción segura…',
  pause: 'Pausar',
  resume: 'Reanudar',
  stop: 'Detener',
  slideToFinish: 'Desliza para terminar',
  cancel: 'Cancelar',
  discardTitle: '¿Descartar esta grabación?',
  discardMessage: 'El audio capturado hasta ahora se eliminará.',
  discardConfirm: 'Descartar',
  discardKeep: 'Seguir grabando',
  closeTitle: '¿Cerrar esta consulta?',
  closeConfirm: 'Cerrar',
  closeKeep: 'Quedarse',
  dismiss: 'Cerrar',

  modeVisit: 'Transcribir',
  modeDictate: 'Dictar',
  templateLabel: 'Plantilla',
  selectTemplate: 'Seleccionar plantilla',
  chooseTemplate: 'Elegir una plantilla…',
  searchTemplates: 'Buscar plantillas…',
  addContext: 'Añadir contexto',
  addContextPlaceholder: 'Añade notas o contexto adicional…',
  done: 'Hecho',

  transcriptTitle: 'Transcripción en vivo',
  transcriptEmpty: 'Escuchando…',

  stageSavingTranscript: 'Guardando transcripción',
  stageUploading: 'Subiendo audio',
  stageTranscribing: 'Transcribiendo la consulta',
  stageGenerating: 'Generando nota',
  reviewNoteTitle: 'Revisar nota',
  approveNote: 'Aprobar y enviar',
  savingNote: 'Guardando…',
  recordingVisitHint: 'Grabando la consulta…',
  finalizingHint: 'Completando las últimas palabras…',
  uploadingHint: 'Subiendo la grabación…',
  transcribingHint: 'Transcribiendo la consulta…',
  generatingHint: 'Generando la nota clínica…',
  generatingStreamingHint: 'Recibiendo la nota de ScribeMD…',
  sessionComplete: 'Sesión completada.',

  setupRequiredTitle: 'Configuración requerida',
  setupRequiredMessage: 'Se necesita un token de sesión para empezar. Proporciónalo mediante ScribeMDProvider antes de abrir una sesión.',
  openSettings: 'Abrir ajustes',

  errorTitle: 'Algo salió mal',
  retry: 'Reintentar',
  errorAuthNotReady: 'Aún no autenticado. Revisa la configuración de ScribeMDProvider.',
  errorAuthFailed: 'La autenticación con ScribeMD falló.',
  errorConnectionFailed: 'No se pudo conectar al servicio de transcripción.',
  errorConnectionLost: 'Se perdió la conexión con el servicio de transcripción.',
  errorMicrophone: 'No se pudo iniciar el micrófono. Revisa los permisos.',
  errorNoteGeneration: 'No se pudo generar la nota. Tu transcripción está a salvo.',
  errorNoteSave: 'Tus cambios no se guardaron en ScribeMD, pero la nota fue entregada.',
  errorSegmentUpload: 'Parte del audio no se pudo subir; se reintentará.',
  errorSegmentLimit: 'Se alcanzó la duración máxima de grabación. Detén la sesión.',

  poweredBy: 'Con tecnología de ScribeMD',
};

// 'iw' is the legacy ISO code some platforms still report for Hebrew.
// Matches the app's supported set: en, he, ar, fr, es.
const locales: Record<string, ScribeStrings> = {
  en: englishStrings,
  he: hebrewStrings,
  iw: hebrewStrings,
  ar: arabicStrings,
  fr: frenchStrings,
  es: spanishStrings,
};

/** Mutable strings object consumed by every SDK component. */
export const strings: ScribeStrings = { ...englishStrings };

let hostOverrides: Partial<ScribeStrings> = {};

/** Override any subset of the SDK copy (i18n hook for host apps). */
export function setStrings(overrides: Partial<ScribeStrings>): void {
  hostOverrides = { ...hostOverrides, ...overrides };
  Object.assign(strings, overrides);
}

/**
 * Apply the built-in locale for a language code (e.g. 'he', 'he-IL').
 * Unknown languages fall back to English. Idempotent; host `setStrings`
 * overrides are re-applied on top so they always win.
 */
export function applyLanguage(language: string | undefined): void {
  const key = (language ?? 'en').toLowerCase().split(/[-_]/)[0];
  Object.assign(strings, locales[key] ?? englishStrings, hostOverrides);
}

const RTL_LANGUAGES = new Set(['he', 'iw', 'ar', 'fa', 'ur', 'yi']);

/** True when the language is written right-to-left (transcript alignment). */
export function isRtlLanguage(language?: string): boolean {
  if (!language) return false;
  return RTL_LANGUAGES.has(language.toLowerCase().split(/[-_]/)[0]);
}
