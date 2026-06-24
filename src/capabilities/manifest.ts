export const capabilityCategories = [
  "core",
  "cli",
  "visual",
  "canvas",
  "graph",
  "workflow",
  "code",
  "file",
  "attachment",
  "image",
  "audio",
  "video",
  "model",
  "search",
  "repair",
  "export",
  "plugin",
  "experimental",
] as const;

export type CapabilityCategory = (typeof capabilityCategories)[number];

export const loadModes = [
  "always",
  "lazy",
  "web_worker",
  "daemon_worker",
  "external_binary",
  "optional_sidecar",
  "reference_only",
  "avoid",
] as const;

export type LoadMode = (typeof loadModes)[number];

export const cpuProfiles = ["tiny", "small", "medium", "heavy", "extreme"] as const;
export type CpuProfile = (typeof cpuProfiles)[number];

export const memoryProfiles = ["tiny", "small", "medium", "heavy", "extreme"] as const;
export type MemoryProfile = (typeof memoryProfiles)[number];

export const capabilityApprovalClasses = [
  "observe",
  "preview",
  "write",
  "destructive",
  "remote",
  "expensive",
] as const;

export type CapabilityApprovalClass = (typeof capabilityApprovalClasses)[number];

export const capabilityCheckpointPolicies = [
  "none",
  "before_preview",
  "before_write",
  "before_and_after",
] as const;

export type CapabilityCheckpointPolicy = (typeof capabilityCheckpointPolicies)[number];

export interface CapabilityManifestSource {
  package?: string;
  repo?: string;
  license: string;
  licenseRisk: "low" | "medium" | "high" | "avoid";
  attributionRequired: boolean;
}

export interface CapabilityManifestRuntime {
  loadMode: LoadMode;
  cpuProfile: CpuProfile;
  memoryProfile: MemoryProfile;
  supportsCancellation: boolean;
  supportsProgress: boolean;
  supportsPreview: boolean;
  offlineCapable: boolean;
  appleSiliconFriendly: boolean;
}

export interface CapabilityManifestBoundaries {
  localOnly: boolean;
  remoteOptional: boolean;
  remoteRequired: boolean;
  sendsUserDataOffMachine: boolean;
  modelDownloadRequired: boolean;
}

export interface CapabilityManifestSafety {
  approvalClass: CapabilityApprovalClass;
  reversible: boolean;
  checkpointPolicy: CapabilityCheckpointPolicy;
  riskNotes: string[];
}

export interface CapabilityManifestIo {
  inputTypes: string[];
  outputTypes: string[];
  sideEffects: string[];
}

export interface CapabilityManifestUi {
  surfaces: Array<
    | "cli"
    | "command_palette"
    | "resume"
    | "approvals"
    | "changes"
    | "map"
    | "canvas"
    | "attachments"
    | "conversation"
    | "library"
    | "settings"
  >;
  density: "calm" | "standard" | "expert";
}

export interface CapabilityManifestProvenance {
  eventTypes: string[];
  storesArtifacts: boolean;
  storesSettings: boolean;
  storesModelInfo: boolean;
}

export interface CapabilityManifestCommands {
  cli: string[];
  api: string[];
}

export interface CapabilityManifestTests {
  required: string[];
  fixtureTypes: string[];
}

export interface CapabilityManifest {
  id: string;
  title: string;
  description: string;
  category: CapabilityCategory;
  source: CapabilityManifestSource;
  runtime: CapabilityManifestRuntime;
  boundaries: CapabilityManifestBoundaries;
  safety: CapabilityManifestSafety;
  io: CapabilityManifestIo;
  ui: CapabilityManifestUi;
  provenance: CapabilityManifestProvenance;
  commands: CapabilityManifestCommands;
  tests: CapabilityManifestTests;
}

export interface CapabilityManifestValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface CapabilityManifestRegistrationResult {
  registered: boolean;
  manifestId: string;
  validation: CapabilityManifestValidationResult;
  manifest?: CapabilityManifest;
}

const STABLE_MANIFEST_ID = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

function cleanStrings(values: readonly string[] | undefined): string[] {
  return (values ?? []).map((value) => value.trim()).filter((value) => value.length > 0);
}

function hasAnyCommand(manifest: Partial<CapabilityManifest>): boolean {
  return cleanStrings(manifest.commands?.cli).length > 0 || cleanStrings(manifest.commands?.api).length > 0;
}

function hasBinaryRiskNote(manifest: Partial<CapabilityManifest>): boolean {
  return (manifest.safety?.riskNotes ?? []).some((note) => /binary/i.test(note));
}

function isAllowed<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && allowed.includes(value as T);
}

function cloneManifest(manifest: CapabilityManifest): CapabilityManifest {
  return structuredClone(manifest);
}

export function validateCapabilityManifest(manifest: Partial<CapabilityManifest>): CapabilityManifestValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const source: Partial<CapabilityManifestSource> = manifest.source ?? {};
  const runtime: Partial<CapabilityManifestRuntime> = manifest.runtime ?? {};
  const boundaries: Partial<CapabilityManifestBoundaries> = manifest.boundaries ?? {};
  const safety: Partial<CapabilityManifestSafety> = manifest.safety ?? {};
  const ui: Partial<CapabilityManifestUi> = manifest.ui ?? {};
  const provenance: Partial<CapabilityManifestProvenance> = manifest.provenance ?? {};
  const commands: Partial<CapabilityManifestCommands> = manifest.commands ?? {};
  const tests: Partial<CapabilityManifestTests> = manifest.tests ?? {};

  const id = typeof manifest.id === "string" ? manifest.id.trim() : "";
  const title = typeof manifest.title === "string" ? manifest.title.trim() : "";
  const description = typeof manifest.description === "string" ? manifest.description.trim() : "";

  if (!id || !STABLE_MANIFEST_ID.test(id)) {
    errors.push("id must be non-empty and stable-looking");
  }

  if (!title) {
    errors.push("title must be non-empty");
  }

  if (!description) {
    errors.push("description must be non-empty");
  }

  if (!isAllowed(manifest.category, capabilityCategories)) {
    errors.push(`category must be one of: ${capabilityCategories.join(", ")}`);
  }

  if (!isAllowed(runtime.loadMode, loadModes)) {
    errors.push(`loadMode must be one of: ${loadModes.join(", ")}`);
  }

  if (!isAllowed(runtime.cpuProfile, cpuProfiles)) {
    errors.push(`cpuProfile must be one of: ${cpuProfiles.join(", ")}`);
  }

  if (!isAllowed(runtime.memoryProfile, memoryProfiles)) {
    errors.push(`memoryProfile must be one of: ${memoryProfiles.join(", ")}`);
  }

  if (!isAllowed(safety.approvalClass, capabilityApprovalClasses)) {
    errors.push(`approvalClass must be one of: ${capabilityApprovalClasses.join(", ")}`);
  }

  if (!isAllowed(safety.checkpointPolicy, capabilityCheckpointPolicies)) {
    errors.push(`checkpointPolicy must be one of: ${capabilityCheckpointPolicies.join(", ")}`);
  }

  if (!source.license || !String(source.license).trim()) {
    errors.push("source.license must be non-empty");
  }

  if (!isAllowed(source.licenseRisk, ["low", "medium", "high", "avoid"] as const)) {
    errors.push("source.licenseRisk must be one of: low, medium, high, avoid");
  }

  if (typeof source.attributionRequired !== "boolean") {
    errors.push("source.attributionRequired must be a boolean");
  }

  if (cleanStrings([source.package, source.repo].filter(Boolean) as string[]).length === 0) {
    errors.push("source must declare at least one package or repo");
  }

  if (cleanStrings(ui.surfaces as string[] | undefined).length === 0) {
    errors.push("ui.surfaces must include at least one surface");
  }

  if (cleanStrings(tests.required).length === 0) {
    warnings.push("tests.required is empty");
  }

  if (cleanStrings(tests.fixtureTypes).length === 0) {
    warnings.push("tests.fixtureTypes is empty");
  }

  if ((boundaries.remoteRequired || boundaries.sendsUserDataOffMachine) && safety.approvalClass !== "remote") {
    errors.push("remoteRequired or sendsUserDataOffMachine capabilities require approvalClass remote");
  }

  if (boundaries.localOnly && boundaries.remoteRequired) {
    errors.push("localOnly and remoteRequired cannot both be true");
  }

  if (boundaries.modelDownloadRequired && provenance.storesModelInfo !== true) {
    errors.push("modelDownloadRequired capabilities must store model info in provenance");
  }

  if (
    safety.approvalClass === "write" ||
    safety.approvalClass === "destructive" ||
    safety.approvalClass === "expensive"
  ) {
    if (!runtime.supportsPreview && cleanStrings(safety.riskNotes).length === 0) {
      errors.push("write/destructive/expensive capabilities must support preview or explain why preview is impossible");
    }
  }

  if ((safety.approvalClass === "write" || safety.approvalClass === "destructive") && safety.checkpointPolicy === "none") {
    errors.push("write/destructive capabilities must not use checkpointPolicy none");
  }

  if (runtime.loadMode === "avoid" || runtime.loadMode === "reference_only") {
    if (hasAnyCommand(manifest)) {
      errors.push("avoid/reference_only capabilities cannot declare active CLI or API commands");
    }
  }

  if ((runtime.cpuProfile === "heavy" || runtime.cpuProfile === "extreme" || runtime.memoryProfile === "heavy" || runtime.memoryProfile === "extreme") && runtime.loadMode === "always") {
    errors.push("heavy/extreme capabilities cannot use loadMode always");
  }

  if (runtime.loadMode === "external_binary" && !hasAnyCommand(manifest) && !hasBinaryRiskNote(manifest)) {
    errors.push("external_binary capabilities must declare at least one CLI command or a binary-related risk note");
  }

  if (safety.approvalClass === "destructive" && safety.reversible === true && cleanStrings(safety.riskNotes).length === 0) {
    errors.push("destructive capabilities with reversible=true must include explicit risk notes");
  }

  if (runtime.supportsCancellation === false && (runtime.cpuProfile === "heavy" || runtime.cpuProfile === "extreme")) {
    warnings.push("heavy/extreme capability does not support cancellation");
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

export class ManifestCapabilityRegistry {
  private readonly manifests = new Map<string, CapabilityManifest>();

  registerCapabilityManifest(manifest: CapabilityManifest): CapabilityManifestRegistrationResult {
    const validation = validateCapabilityManifest(manifest);

    if (!validation.valid) {
      return {
        registered: false,
        manifestId: typeof manifest?.id === "string" ? manifest.id : "",
        validation,
      };
    }

    const snapshot = cloneManifest(manifest);
    this.manifests.set(snapshot.id, snapshot);

    return {
      registered: true,
      manifestId: snapshot.id,
      validation,
      manifest: cloneManifest(snapshot),
    };
  }

  listCapabilityManifests(): CapabilityManifest[] {
    return [...this.manifests.values()].map((manifest) => cloneManifest(manifest));
  }

  getCapabilityManifest(id: string): CapabilityManifest | undefined {
    const manifest = this.manifests.get(id);
    return manifest ? cloneManifest(manifest) : undefined;
  }
}

export const seedCapabilityManifests: readonly CapabilityManifest[] = [
  {
    id: "uppy.attachment.ingest",
    title: "Uppy Attachment Ingest",
    description: "Local-only attachment ingest capability for explicit preview-and-import flows, plus safe local metadata and tag edits in the Spectra workbench.",
    category: "attachment",
    source: {
      package: "@uppy/core + @uppy/drag-drop",
      repo: "transloadit/uppy",
      license: "MIT",
      licenseRisk: "low",
      attributionRequired: false,
    },
    runtime: {
      loadMode: "lazy",
      cpuProfile: "small",
      memoryProfile: "small",
      supportsCancellation: true,
      supportsProgress: true,
      supportsPreview: true,
      offlineCapable: true,
      appleSiliconFriendly: true,
    },
    boundaries: {
      localOnly: true,
      remoteOptional: false,
      remoteRequired: false,
      sendsUserDataOffMachine: false,
      modelDownloadRequired: false,
    },
    safety: {
      approvalClass: "write",
      reversible: true,
      checkpointPolicy: "before_write",
      riskNotes: [
        "Local files are selected explicitly and imported only after a user click.",
        "Companion and remote providers are disabled for this sprint.",
      ],
    },
    io: {
      inputTypes: ["file", "attachment"],
      outputTypes: ["attachment-record", "preview-card", "import-event", "attachment-metadata", "attachment-tags"],
      sideEffects: ["reads_local_files", "writes_attachment_records", "updates_attachment_metadata", "updates_attachment_tags", "emits_ingest_events"],
    },
    ui: {
      surfaces: ["attachments", "command_palette", "resume", "approvals"],
      density: "calm",
    },
    provenance: {
      eventTypes: [
        "attachment.ingest.opened",
        "attachment.ingest.previewed",
        "attachment.ingest.cancelled",
        "attachment.ingest.completed",
        "attachment.tag.added",
        "attachment.tag.removed",
        "attachment.metadata.updated",
        "artifact.observed",
        "artifact.written",
      ],
      storesArtifacts: true,
      storesSettings: false,
      storesModelInfo: false,
    },
    commands: {
      cli: ["prism workbench attachments import-local"],
      api: [
        "POST /api/v1/workbench/attachments/import-local",
        "PATCH /api/v1/workbench/attachments/:id",
        "POST /api/v1/workbench/attachments/:id/tags",
        "DELETE /api/v1/workbench/attachments/:id/tags/:tag",
      ],
    },
    tests: {
      required: ["manifest-validation", "registry-rejection", "local-ingest-route-contract", "attachment-metadata-contract", "attachment-tag-contract"],
      fixtureTypes: ["attachment-file", "preview-card"],
    },
  },
  {
    id: "wavesurfer.audio.preview",
    title: "wavesurfer.js Audio Preview",
    description: "Lazy, local-only waveform preview surface for supported audio attachments.",
    category: "audio",
    source: {
      package: "wavesurfer.js",
      repo: "katspaugh/wavesurfer.js",
      license: "BSD-3-Clause",
      licenseRisk: "low",
      attributionRequired: false,
    },
    runtime: {
      loadMode: "lazy",
      cpuProfile: "small",
      memoryProfile: "medium",
      supportsCancellation: true,
      supportsProgress: false,
      supportsPreview: true,
      offlineCapable: true,
      appleSiliconFriendly: true,
    },
    boundaries: {
      localOnly: true,
      remoteOptional: false,
      remoteRequired: false,
      sendsUserDataOffMachine: false,
      modelDownloadRequired: false,
    },
    safety: {
      approvalClass: "observe",
      reversible: true,
      checkpointPolicy: "none",
      riskNotes: [
        "preview-only audio rendering",
        "Large audio files may use more memory while wavesurfer.js decodes the waveform in the browser.",
      ],
    },
    io: {
      inputTypes: ["audio-file"],
      outputTypes: ["waveform-preview", "playback-state"],
      sideEffects: ["reads_local_audio_bytes"],
    },
    ui: {
      surfaces: ["attachments", "changes"],
      density: "calm",
    },
    provenance: {
      eventTypes: [
        "capability.registered",
        "attachment.audio.preview.opened",
        "attachment.audio.preview.ready",
        "attachment.audio.preview.closed",
        "attachment.audio.preview.failed",
      ],
      storesArtifacts: false,
      storesSettings: true,
      storesModelInfo: false,
    },
    commands: {
      cli: ["prism capability open wavesurfer.audio.preview"],
      api: ["GET /api/v1/capabilities/wavesurfer.audio.preview"],
    },
    tests: {
      required: ["manifest-validation", "preview-contract"],
      fixtureTypes: ["audio-file", "waveform-frame"],
    },
  },
  {
    id: "sharp.image.thumbnail",
    title: "Sharp Image Thumbnail",
    description: "Daemon-worker image thumbnailing and resize support for local previews and exports.",
    category: "image",
    source: {
      package: "sharp",
      repo: "lovell/sharp",
      license: "Apache-2.0",
      licenseRisk: "low",
      attributionRequired: true,
    },
    runtime: {
      loadMode: "daemon_worker",
      cpuProfile: "medium",
      memoryProfile: "small",
      supportsCancellation: true,
      supportsProgress: true,
      supportsPreview: true,
      offlineCapable: true,
      appleSiliconFriendly: true,
    },
    boundaries: {
      localOnly: true,
      remoteOptional: false,
      remoteRequired: false,
      sendsUserDataOffMachine: false,
      modelDownloadRequired: false,
    },
    safety: {
      approvalClass: "write",
      reversible: true,
      checkpointPolicy: "before_write",
      riskNotes: ["thumbnail generation writes derived artifacts that can be regenerated"],
    },
    io: {
      inputTypes: ["image-file"],
      outputTypes: ["thumbnail", "resized-image", "metadata"],
      sideEffects: ["writes_thumbnail_artifacts", "reads_local_images"],
    },
    ui: {
      surfaces: ["attachments", "changes", "command_palette"],
      density: "standard",
    },
    provenance: {
      eventTypes: ["capability.registered", "capability.job.started", "capability.job.completed"],
      storesArtifacts: true,
      storesSettings: false,
      storesModelInfo: false,
    },
    commands: {
      cli: ["prism capability run sharp.image.thumbnail"],
      api: ["POST /api/v1/capabilities/sharp.image.thumbnail"],
    },
    tests: {
      required: ["manifest-validation", "thumbnail-write-contract"],
      fixtureTypes: ["image-file", "thumbnail-artifact"],
    },
  },
  {
    id: "ffmpeg.video.clip",
    title: "FFmpeg Video Clip",
    description: "External-binary media job for local clipping, transcode, and contact-sheet workflows.",
    category: "video",
    source: {
      package: "ffmpeg",
      repo: "FFmpeg/FFmpeg",
      license: "LGPL-2.1-or-later",
      licenseRisk: "medium",
      attributionRequired: true,
    },
    runtime: {
      loadMode: "external_binary",
      cpuProfile: "heavy",
      memoryProfile: "heavy",
      supportsCancellation: true,
      supportsProgress: true,
      supportsPreview: true,
      offlineCapable: true,
      appleSiliconFriendly: true,
    },
    boundaries: {
      localOnly: true,
      remoteOptional: false,
      remoteRequired: false,
      sendsUserDataOffMachine: false,
      modelDownloadRequired: false,
    },
    safety: {
      approvalClass: "expensive",
      reversible: true,
      checkpointPolicy: "before_and_after",
      riskNotes: ["external binary job can consume substantial CPU and storage"],
    },
    io: {
      inputTypes: ["video-file", "audio-file"],
      outputTypes: ["clip", "contact-sheet", "transcoded-media"],
      sideEffects: ["reads_media_files", "writes_derived_media"],
    },
    ui: {
      surfaces: ["attachments", "changes", "resume", "command_palette"],
      density: "standard",
    },
    provenance: {
      eventTypes: ["capability.job.started", "capability.job.progress", "capability.job.completed", "capability.job.failed"],
      storesArtifacts: true,
      storesSettings: false,
      storesModelInfo: false,
    },
    commands: {
      cli: ["ffmpeg"],
      api: ["POST /api/v1/capabilities/ffmpeg.video.clip"],
    },
    tests: {
      required: ["manifest-validation", "binary-job-contract"],
      fixtureTypes: ["video-file", "clip-artifact"],
    },
  },
  {
    id: "whispercpp.transcribe",
    title: "whisper.cpp Transcription",
    description: "Local transcription job for audio-to-text and subtitle generation workflows.",
    category: "model",
    source: {
      package: "whisper.cpp",
      repo: "ggerganov/whisper.cpp",
      license: "MIT",
      licenseRisk: "low",
      attributionRequired: false,
    },
    runtime: {
      loadMode: "external_binary",
      cpuProfile: "heavy",
      memoryProfile: "heavy",
      supportsCancellation: true,
      supportsProgress: true,
      supportsPreview: true,
      offlineCapable: true,
      appleSiliconFriendly: true,
    },
    boundaries: {
      localOnly: true,
      remoteOptional: false,
      remoteRequired: false,
      sendsUserDataOffMachine: false,
      modelDownloadRequired: true,
    },
    safety: {
      approvalClass: "expensive",
      reversible: true,
      checkpointPolicy: "before_and_after",
      riskNotes: ["preview is limited to short audio snippets and transcripts"],
    },
    io: {
      inputTypes: ["audio-file", "video-file"],
      outputTypes: ["transcript", "subtitle-file", "confidence-map"],
      sideEffects: ["reads_media_files", "downloads_models"],
    },
    ui: {
      surfaces: ["attachments", "changes", "resume", "command_palette"],
      density: "standard",
    },
    provenance: {
      eventTypes: ["capability.job.started", "capability.job.progress", "capability.job.completed"],
      storesArtifacts: true,
      storesSettings: true,
      storesModelInfo: true,
    },
    commands: {
      cli: ["whisper.cpp"],
      api: ["POST /api/v1/capabilities/whispercpp.transcribe"],
    },
    tests: {
      required: ["manifest-validation", "transcription-contract"],
      fixtureTypes: ["audio-file", "transcript-artifact", "subtitle-file"],
    },
  },
  {
    id: "excalidraw.canvas.notes",
    title: "Excalidraw Canvas Notes",
    description: "Calm canvas notes and sketch surface for low-pressure visual thinking.",
    category: "canvas",
    source: {
      package: "@excalidraw/excalidraw",
      repo: "excalidraw/excalidraw",
      license: "MIT",
      licenseRisk: "low",
      attributionRequired: false,
    },
    runtime: {
      loadMode: "lazy",
      cpuProfile: "small",
      memoryProfile: "small",
      supportsCancellation: true,
      supportsProgress: false,
      supportsPreview: true,
      offlineCapable: true,
      appleSiliconFriendly: true,
    },
    boundaries: {
      localOnly: true,
      remoteOptional: false,
      remoteRequired: false,
      sendsUserDataOffMachine: false,
      modelDownloadRequired: false,
    },
    safety: {
      approvalClass: "write",
      reversible: true,
      checkpointPolicy: "before_write",
      riskNotes: ["canvas state should be checkpointed before saved edits"],
    },
    io: {
      inputTypes: ["canvas-note", "sketch", "annotation"],
      outputTypes: ["canvas-scene", "exported-image", "shareable-note"],
      sideEffects: ["writes_canvas_artifacts"],
    },
    ui: {
      surfaces: ["canvas", "resume", "command_palette", "library"],
      density: "calm",
    },
    provenance: {
      eventTypes: ["capability.registered", "capability.job.preview_ready", "capability.job.completed"],
      storesArtifacts: true,
      storesSettings: true,
      storesModelInfo: false,
    },
    commands: {
      cli: ["prism capability open excalidraw.canvas.notes"],
      api: ["GET /api/v1/capabilities/excalidraw.canvas.notes"],
    },
    tests: {
      required: ["manifest-validation", "canvas-save-contract"],
      fixtureTypes: ["canvas-scene", "note-card"],
    },
  },
  {
    id: "xyflow.project.map",
    title: "xyflow Project Map",
    description: "Focused project map scaffold for current task, lineage, and next safe action views.",
    category: "graph",
    source: {
      package: "@xyflow/react",
      repo: "xyflow/xyflow",
      license: "MIT",
      licenseRisk: "low",
      attributionRequired: false,
    },
    runtime: {
      loadMode: "lazy",
      cpuProfile: "medium",
      memoryProfile: "medium",
      supportsCancellation: true,
      supportsProgress: false,
      supportsPreview: true,
      offlineCapable: true,
      appleSiliconFriendly: true,
    },
    boundaries: {
      localOnly: true,
      remoteOptional: false,
      remoteRequired: false,
      sendsUserDataOffMachine: false,
      modelDownloadRequired: false,
    },
    safety: {
      approvalClass: "write",
      reversible: true,
      checkpointPolicy: "before_write",
      riskNotes: ["project maps should remain focused and bounded"],
    },
    io: {
      inputTypes: ["graph-node", "graph-edge", "event-feed"],
      outputTypes: ["project-map", "neighborhood-map", "lineage-map"],
      sideEffects: ["writes_graph_state"],
    },
    ui: {
      surfaces: ["map", "resume", "changes", "command_palette"],
      density: "standard",
    },
    provenance: {
      eventTypes: ["capability.registered", "capability.job.preview_ready", "capability.job.completed"],
      storesArtifacts: true,
      storesSettings: true,
      storesModelInfo: false,
    },
    commands: {
      cli: ["prism capability open xyflow.project.map"],
      api: ["GET /api/v1/capabilities/xyflow.project.map"],
    },
    tests: {
      required: ["manifest-validation", "graph-map-contract"],
      fixtureTypes: ["graph-node", "graph-edge", "project-map"],
    },
  },
  {
    id: "transformers.local.captioning",
    title: "Transformers.js Local Captioning",
    description: "Small local multimodal captioning/classification scaffold running in a worker boundary.",
    category: "model",
    source: {
      package: "@xenova/transformers",
      repo: "huggingface/transformers.js",
      license: "Apache-2.0",
      licenseRisk: "low",
      attributionRequired: true,
    },
    runtime: {
      loadMode: "web_worker",
      cpuProfile: "medium",
      memoryProfile: "medium",
      supportsCancellation: true,
      supportsProgress: true,
      supportsPreview: true,
      offlineCapable: true,
      appleSiliconFriendly: true,
    },
    boundaries: {
      localOnly: true,
      remoteOptional: false,
      remoteRequired: false,
      sendsUserDataOffMachine: false,
      modelDownloadRequired: true,
    },
    safety: {
      approvalClass: "expensive",
      reversible: true,
      checkpointPolicy: "before_and_after",
      riskNotes: ["model downloads and inference should be explicitly approved before first use"],
    },
    io: {
      inputTypes: ["image", "text", "attachment-metadata"],
      outputTypes: ["caption", "label-set", "confidence-map"],
      sideEffects: ["downloads_models", "reads_attachment_metadata"],
    },
    ui: {
      surfaces: ["attachments", "changes", "command_palette", "library"],
      density: "standard",
    },
    provenance: {
      eventTypes: ["capability.job.started", "capability.job.progress", "capability.job.completed"],
      storesArtifacts: true,
      storesSettings: true,
      storesModelInfo: true,
    },
    commands: {
      cli: ["prism capability run transformers.local.captioning"],
      api: ["POST /api/v1/capabilities/transformers.local.captioning"],
    },
    tests: {
      required: ["manifest-validation", "captioning-contract"],
      fixtureTypes: ["image-file", "caption-artifact"],
    },
  },
] as const;
