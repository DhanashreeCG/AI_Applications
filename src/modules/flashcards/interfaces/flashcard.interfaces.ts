import { ComponentType } from '../constants/flashcard.constants';

export interface TemplateComponentDefinition {
  componentId: string;
  componentType: ComponentType;
  editable: boolean;
  required: boolean;
  validationRules?: Record<string, unknown>;
}

export interface TemplateLayoutDefinition {
  root: string;
  slots: Array<{
    componentId: string;
    role: string;
  }>;
}

export interface TemplateSelectionCriteria {
  ageMin?: number | null;
  ageMax?: number | null;
  age?: number;
  grade?: string;
  subject?: string;
  topic?: string;
  learningObjective?: string;
  intent?: string;
  difficulty?: string;
}

export interface ScoredTemplateMatch {
  templateId: string;
  ruleId: string;
  ruleName: string;
  priority: number;
  score: number;
}

export interface LlmCardContent {
  cardIndex: number;
  components: Record<string, string>;
  imageSearchQueries: string[];
}

export interface LlmFlashcardPayload {
  cards: LlmCardContent[];
  resolvedLearningObjective?: string;
}

export type ImageRetrievalStatus =
  | 'found'
  | 'found_after_retry'
  | 'not_found'
  | 'timeout'
  | 'error';

export interface AssetReference {
  assetId: string | null;
  s3ObjectKey: string | null;
  signedUrl: string | null;
  /** Same-origin proxy path; avoids S3 CORS for canvas-based renderers. */
  imageUrl: string | null;
  caption: string | null;
  similarity: number | null;
  mimeType: string | null;
  status: ImageRetrievalStatus;
  queryUsed: string;
  attempts: string[];
}

export interface EditableComponentPayload {
  componentId: string;
  componentType: ComponentType;
  editable: boolean;
  content: string | null;
  validationRules?: Record<string, unknown>;
  assetReference?: AssetReference | null;
}

export interface FlashcardCardPayload {
  cardIndex: number;
  components: EditableComponentPayload[];
}

export interface SelectedTemplatePayload {
  id: string;
  name: string;
  description: string | null;
  templateVersion: string;
  supportedAgeMin: number;
  supportedAgeMax: number;
  learningObjectives: string[];
  layoutDefinition: unknown;
  editableComponents: unknown;
  componentHierarchy: unknown;
  componentConstraints: unknown;
  renderingHints: unknown;
  defaultStyles: unknown;
}

export interface GenerateFlashcardsResponse {
  request: {
    query: string;
    topic: string;
    ageGroup: string;
    ageMin: number;
    ageMax: number;
    learningObjective: string;
    count: number;
  };
  selection: {
    ruleId: string;
    ruleName: string;
    score: number;
    priority: number;
  };
  template: SelectedTemplatePayload;
  cards: FlashcardCardPayload[];
  renderingMetadata: {
    generatedAt: string;
    promptVersion: string;
    contentModel: string;
    imageConcurrency: number;
    requestId?: string;
    executionId?: string;
    correlationId?: string;
  };
}

export type FlashcardErrorCode =
  | 'INVALID_REQUEST'
  | 'NO_TEMPLATE_FOUND'
  | 'UNSUPPORTED_AGE'
  | 'UNSUPPORTED_SUBJECT'
  | 'UNKNOWN_LEARNING_OBJECTIVE'
  | 'INVALID_LLM_OUTPUT'
  | 'LLM_TIMEOUT'
  | 'RETRY_EXHAUSTION'
  | 'TEMPLATE_VERSION_MISMATCH'
  | 'MISSING_EDITABLE_COMPONENT'
  | 'IMAGE_SEARCH_TIMEOUT'
  | 'PARTIAL_IMAGE_FAILURE';
