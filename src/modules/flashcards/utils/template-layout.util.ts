import { Prisma } from '@generated/prisma/client';
import { ComponentType } from '../constants/flashcard.constants';
import { FlashcardException } from '../errors/flashcard.exception';
import {
  TemplateComponentDefinition,
  TemplateLayoutComponent,
  TemplateLayoutDefinition,
  TemplateLayoutRegion,
} from '../interfaces/flashcard.interfaces';

export { parseAgeGroupBounds } from './age-group.util';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value.trim() : null;
}

/**
 * Parse layoutDefinition and return editable components.
 *
 * Supports:
 * 1. New region layout: `{ regions: [{ id, components: [{ id, type, editable }] }] }`
 * 2. Legacy layout: `{ editableComponents: [{ componentId, componentType, ... }] }`
 *    (still present on templates seeded/migrated before the regions redesign)
 */
export function parseEditableComponentsFromLayout(
  layoutDefinition: unknown,
): TemplateComponentDefinition[] {
  const layout = parseLayoutDefinition(layoutDefinition);
  const editable: TemplateComponentDefinition[] = [];

  for (const region of layout.regions) {
    for (const component of region.components) {
      if (component.editable === false) {
        continue;
      }

      editable.push({
        componentId: component.id,
        componentType: component.type as ComponentType,
        editable: true,
        required: component.required !== false,
        validationRules: component.validationRules,
        regionId: region.id,
      });
    }
  }

  if (!editable.length) {
    throw new FlashcardException(
      'MISSING_EDITABLE_COMPONENT',
      'layoutDefinition must include at least one editable component',
    );
  }

  return editable;
}

/** Flattened component id order from regions (for rendering). */
export function listComponentOrderFromLayout(
  layoutDefinition: unknown,
): string[] {
  try {
    const layout = parseLayoutDefinition(layoutDefinition);
    return layout.regions.flatMap((region) =>
      region.components.map((component) => component.id),
    );
  } catch {
    return [];
  }
}

/**
 * Normalize any supported layout shape into the region-based contract.
 */
export function parseLayoutDefinition(
  layoutDefinition: unknown,
): TemplateLayoutDefinition {
  if (!isRecord(layoutDefinition)) {
    throw new FlashcardException(
      'INVALID_REQUEST',
      'layoutDefinition must be an object',
    );
  }

  if (Array.isArray(layoutDefinition.regions) && layoutDefinition.regions.length) {
    return parseRegionLayout(layoutDefinition.regions);
  }

  const legacy = tryParseLegacyLayout(layoutDefinition);
  if (legacy) {
    return legacy;
  }

  throw new FlashcardException(
    'INVALID_REQUEST',
    'layoutDefinition.regions must be a non-empty array (or provide legacy editableComponents)',
  );
}

function parseRegionLayout(rawRegions: unknown[]): TemplateLayoutDefinition {
  const regions: TemplateLayoutRegion[] = rawRegions.map(
    (region, regionIndex) => {
      if (!isRecord(region)) {
        throw new FlashcardException(
          'INVALID_REQUEST',
          `layoutDefinition.regions[${regionIndex}] must be an object`,
        );
      }

      const regionId = asString(region.id);
      if (!regionId) {
        throw new FlashcardException(
          'INVALID_REQUEST',
          `layoutDefinition.regions[${regionIndex}].id is required`,
        );
      }

      if (!Array.isArray(region.components) || !region.components.length) {
        throw new FlashcardException(
          'INVALID_REQUEST',
          `layoutDefinition.regions[${regionIndex}].components must be a non-empty array`,
        );
      }

      const components: TemplateLayoutComponent[] = region.components.map(
        (component, componentIndex) => {
          if (!isRecord(component)) {
            throw new FlashcardException(
              'INVALID_REQUEST',
              `layoutDefinition.regions[${regionIndex}].components[${componentIndex}] must be an object`,
            );
          }

          const id = asString(component.id);
          const type = asString(component.type);
          if (!id || !type) {
            throw new FlashcardException(
              'MISSING_EDITABLE_COMPONENT',
              `layoutDefinition.regions[${regionIndex}].components[${componentIndex}] requires id and type`,
            );
          }

          return {
            id,
            type,
            editable: component.editable !== false,
            required:
              typeof component.required === 'boolean'
                ? component.required
                : undefined,
            validationRules: isRecord(component.validationRules)
              ? component.validationRules
              : undefined,
          };
        },
      );

      return {
        id: regionId,
        components,
        flex: region.flex !== undefined ? (region.flex as any) : undefined,
        gap: region.gap !== undefined ? (region.gap as any) : undefined,
        padding: region.padding !== undefined ? (region.padding as any) : undefined,
        background: region.background !== undefined ? String(region.background) : undefined,
        border: region.border !== undefined ? String(region.border) : undefined,
        alignment: region.alignment !== undefined ? String(region.alignment) : undefined,
        orientation: region.orientation !== undefined ? String(region.orientation) : undefined,
        visibility: typeof region.visibility === 'boolean' ? region.visibility : undefined,
        visible: typeof region.visible === 'boolean' ? region.visible : undefined,
      };
    },
  );

  return { regions };
}

/**
 * Convert pre-regions templates (slots + editableComponents) into a single
 * body region so generate/upload consumers share one code path.
 */
function tryParseLegacyLayout(
  layoutDefinition: Record<string, unknown>,
): TemplateLayoutDefinition | null {
  const rawComponents = layoutDefinition.editableComponents;
  if (!Array.isArray(rawComponents) || !rawComponents.length) {
    return null;
  }

  const components: TemplateLayoutComponent[] = [];
  for (const [index, item] of rawComponents.entries()) {
    if (!isRecord(item)) {
      throw new FlashcardException(
        'TEMPLATE_VERSION_MISMATCH',
        `editableComponents[${index}] is not an object`,
      );
    }

    const id =
      asString(item.id) ??
      asString(item.componentId);
    const type =
      asString(item.type) ??
      asString(item.componentType);

    if (!id || !type) {
      throw new FlashcardException(
        'MISSING_EDITABLE_COMPONENT',
        `editableComponents[${index}] missing id/type (or componentId/componentType)`,
      );
    }

    components.push({
      id,
      type,
      editable: item.editable !== false,
      required:
        typeof item.required === 'boolean' ? item.required : undefined,
      validationRules: isRecord(item.validationRules)
        ? item.validationRules
        : undefined,
    });
  }

  // Preserve hierarchy order when present.
  const hierarchy = Array.isArray(layoutDefinition.componentHierarchy)
    ? layoutDefinition.componentHierarchy
        .map((value) => asString(value))
        .filter((value): value is string => Boolean(value))
    : [];

  if (hierarchy.length) {
    const byId = new Map(components.map((component) => [component.id, component]));
    const ordered: TemplateLayoutComponent[] = [];
    for (const id of hierarchy) {
      const component = byId.get(id);
      if (component) {
        ordered.push(component);
        byId.delete(id);
      }
    }
    ordered.push(...byId.values());
    return { regions: [{ id: 'body', components: ordered }] };
  }

  return { regions: [{ id: 'body', components }] };
}

export function buildRegionLayout(input: {
  regions: TemplateLayoutRegion[];
}): Prisma.InputJsonValue {
  return { regions: input.regions } as unknown as Prisma.InputJsonValue;
}
