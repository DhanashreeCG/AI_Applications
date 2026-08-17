export const WORKSHEET_ERROR_CODES = [
  'INVALID_REQUEST',
  'NO_TEMPLATE_FOUND',
  'TEMPLATE_NOT_FOUND',
  'WORKSHEET_NOT_FOUND',
  'FIELD_NOT_EDITABLE',
  'INVALID_FIELD',
  'INVALID_LLM_OUTPUT',
  'INVALID_STRUCTURE',
  'UNSUPPORTED_RENDERER',
  'UNSUPPORTED_FORMAT',
  'RENDER_FAILED',
  'ASSET_NOT_FOUND',
  'CONTENT_CLIENT_UNAVAILABLE',
] as const;

export type WorksheetErrorCode = (typeof WORKSHEET_ERROR_CODES)[number];

export const WORKSHEET_RENDER_FORMATS = ['html', 'webp', 'pdf'] as const;
export type WorksheetRenderFormat = (typeof WORKSHEET_RENDER_FORMATS)[number];

export const WORKSHEET_RENDER_MODES = ['editor', 'export'] as const;
export type WorksheetRenderMode = (typeof WORKSHEET_RENDER_MODES)[number];

export interface WorksheetTemplateMeta {
  grades?: string[];
  subjects?: string[];
  topics?: string[];
  ageMin?: number;
  ageMax?: number;
  difficulty?: string[];
}

export type WorksheetEditableFieldType =
  | 'text'
  | 'number'
  | 'array'
  | 'image'
  | 'object';

export interface WorksheetAiConfig {
  editableFields?: string[];
  aiEditable?: string[];
  linkedFields?: Record<string, string[]>;
  /** Prototype-style map; normalized to EditableField before the editor sees it. */
  editable_fields?: Record<string, Record<string, unknown>>;
}

export interface EditableField {
  type: WorksheetEditableFieldType;
  path: string;
  editable: boolean;
  aiEditable: boolean;
  selector?: string;
}

export interface WorksheetFieldPrompts {
  [field: string]: string;
}

export interface WorksheetRendererConfig {
  width?: number;
  height?: number;
  title?: string;
}

export interface JsonSchemaNode {
  type?: string;
  properties?: Record<string, JsonSchemaNode>;
  required?: string[];
  additionalProperties?: boolean;
  items?: JsonSchemaNode;
  minItems?: number;
  maxItems?: number;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  enum?: Array<string | number | boolean>;
  pattern?: string;
}

export interface GenerateWorksheetRequest {
  query?: string;
  grade?: string;
  age?: number;
  ageGroup?: string;
  subject?: string;
  topic?: string;
  difficulty?: string;
  language?: string;
  templateId?: string;
}

export interface GenerateWorksheetResponse {
  id: string;
  status: string;
  template: {
    id: string;
    slug: string;
    name: string;
    rendererType: string;
  };
  request: GenerateWorksheetRequest;
  structure: Record<string, unknown>;
  html?: string;
  canvas?: { width: number; height: number };
}

export interface WorksheetRenderInput {
  templateHtml: string;
  structure: Record<string, unknown>;
  rendererConfig?: WorksheetRendererConfig | null;
  backgroundAssetUrl?: string | null;
  mode?: WorksheetRenderMode;
  canvas?: { width: number; height: number };
  topic?: string;
  baseHref?: string;
  pencilIconUrl?: string;
}

export interface ResolvedAssetSlot {
  path: string;
  imageQuery: string;
  assetId: string | null;
}

export interface ResolvedAssetUrl {
  assetId: string;
  imageUrl: string;
  signedUrl: string | null;
}

export interface ImageSlotRef {
  slotId: string;
  path: string;
  assetId: string | null;
  imageQuery: string;
}
