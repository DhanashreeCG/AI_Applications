-- Phonics layouts that also carry a tracing slot are gated, but a genuine
-- phonics request must still be able to unlock them.
UPDATE "FlashcardTemplate"
SET "explicit_request_keywords" = ARRAY(
  SELECT DISTINCT keyword
  FROM unnest(
    "explicit_request_keywords" || ARRAY[
      'phonics',
      'sound',
      'sounds',
      'letter sound',
      'beginning sound',
      'starts with',
      'spelling'
    ]
  ) AS keyword
)
WHERE "requires_explicit_request" = true
  AND "templateType" ILIKE '%phonics%';
