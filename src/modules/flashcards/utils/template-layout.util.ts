import { Prisma } from '@generated/prisma/client';
import { ComponentType } from '../constants/flashcard.constants';
import { FlashcardException } from '../errors/flashcard.exception';
import {
  TemplateComponentDefinition,
  TemplateLayoutComponent,
  TemplateLayoutDefinition,
  TemplateLayoutRegion,
} from '../interfaces/flashcard.interfaces';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value.trim() : null;
}

/**
 * Parse region-based layoutDefinition and return editable components.
 * Editable is marked on each component (`editable: true`); there is no
 * separate editableComponents array.
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
      'layoutDefinition.regions must include at least one editable component',
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

export function parseLayoutDefinition(
  layoutDefinition: unknown,
): TemplateLayoutDefinition {
  if (!isRecord(layoutDefinition)) {
    throw new FlashcardException(
      'INVALID_REQUEST',
      'layoutDefinition must be an object',
    );
  }

  if (!Array.isArray(layoutDefinition.regions) || !layoutDefinition.regions.length) {
    throw new FlashcardException(
      'INVALID_REQUEST',
      'layoutDefinition.regions must be a non-empty array',
    );
  }

  const regions: TemplateLayoutRegion[] = layoutDefinition.regions.map(
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

      return { id: regionId, components };
    },
  );

  return { regions };
}

export function parseAgeGroupBounds(
  groups: string[],
): { min: number; max: number } | null {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (const group of groups) {
    const match = group.match(/(\d+)\s*-\s*(\d+)/);
    if (!match) {
      continue;
    }
    min = Math.min(min, Number(match[1]));
    max = Math.max(max, Number(match[2]));
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return null;
  }

  return { min, max };
}

export function buildRegionLayout(input: {
  regions: TemplateLayoutRegion[];
}): Prisma.InputJsonValue {
  return { regions: input.regions } as unknown as Prisma.InputJsonValue;
}
