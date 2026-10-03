// Preview-only roof summary shown before contact details: whole roofing squares
// (same measured-sqft / 100 basis as the pricing function) and a plain-language
// complexity label. It never carries a price.

export type RoofComplexity = "simple" | "moderate" | "complex";

type Segment = {pitchDegrees: number; areaSqft: number};

const COMPLEX_PLANE_COUNT = 10;
const COMPLEX_PITCH_RANGE_DEGREES = 25;
const SIMPLE_PLANE_COUNT = 4;
const SIMPLE_PITCH_RANGE_DEGREES = 10;

export function summarizeRoofForPreview(input: {totalRoofSqft: number; roofSegments: readonly Segment[]}) {
  const squares = Math.max(1, Math.round(input.totalRoofSqft / 100));
  const pitches = input.roofSegments.map((segment) => segment.pitchDegrees);
  const pitchRange = pitches.length ? Math.max(...pitches) - Math.min(...pitches) : 0;
  const planes = input.roofSegments.length;

  let complexity: RoofComplexity = "moderate";
  if (planes >= COMPLEX_PLANE_COUNT || pitchRange > COMPLEX_PITCH_RANGE_DEGREES) complexity = "complex";
  else if (planes <= SIMPLE_PLANE_COUNT && pitchRange <= SIMPLE_PITCH_RANGE_DEGREES) complexity = "simple";

  return {squares, complexity};
}
