import React, { useId } from 'react';
import Svg, { Path, Defs, LinearGradient, Stop, Rect, G, Mask } from 'react-native-svg';

interface LogoProps {
  size?: number;
}

/**
 * The Matinee mark: a rounded gradient tile carrying a filmstrip "M".
 *
 * The sprocket holes are punched out with a mask rather than painted over the
 * white "M" with a second copy of the gradient. Painting them meant each 4×6
 * hole sampled its own full gradient sweep — SVG gradients default to the
 * element's own bounding box — so every hole showed the same cyan-to-teal
 * run in miniature instead of the one colour the tile happens to be at that
 * point. Masking punches through to the single tile gradient underneath, which
 * is what makes the holes read as holes.
 *
 * `assets/images/matinee-mark.svg` is the same artwork; keep the two in step.
 */
export default function Logo({ size = 32 }: LogoProps) {
  // Ids are document-global in SVG. Two Logos on one screen sharing a literal
  // id would make the second one reuse the first's gradient and mask.
  const uid = useId().replace(/:/g, '');
  const gradientId = `matineeLogoGradient-${uid}`;
  const maskId = `matineeLogoFilm-${uid}`;

  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" fill="none">
      <Defs>
        {/* userSpaceOnUse so every fill samples the same sweep across the whole
            mark, not a private one scaled to its own bounding box. */}
        <LinearGradient
          id={gradientId}
          gradientUnits="userSpaceOnUse"
          x1="15"
          y1="15"
          x2="85"
          y2="85"
        >
          <Stop offset="0%" stopColor="#2FB8EE" />
          <Stop offset="50%" stopColor="#00AC92" />
          <Stop offset="100%" stopColor="#005849" />
        </LinearGradient>

        {/* White keeps the pixel, black drops it: the "M" is kept and the
            sprocket holes are cut back out of it. */}
        <Mask id={maskId}>
          <Rect x={0} y={0} width={100} height={100} fill="black" />
          <Path
            fill="white"
            d="M26 34 C26 29.5, 29.5 26, 34 26 C38.5 26, 42 29.5, 42 34 V44 L50 54 L58 44 V34 C58 29.5, 61.5 26, 66 26 C70.5 26, 74 29.5, 74 34 V66 C74 70.5, 70.5 74, 66 74 C61.5 74, 58 70.5, 58 66 V56 L50 64 L42 56 V66 C42 70.5, 38.5 74, 34 74 C29.5 74, 26 70.5, 26 66 Z"
          />
          <G fill="black">
            <Rect x={32} y={31} width={4} height={6} rx={1.5} />
            <Rect x={32} y={41} width={4} height={6} rx={1.5} />
            <Rect x={32} y={51} width={4} height={6} rx={1.5} />
            <Rect x={32} y={61} width={4} height={6} rx={1.5} />
            <Rect x={64} y={31} width={4} height={6} rx={1.5} />
            <Rect x={64} y={41} width={4} height={6} rx={1.5} />
            <Rect x={64} y={51} width={4} height={6} rx={1.5} />
            <Rect x={64} y={61} width={4} height={6} rx={1.5} />
          </G>
        </Mask>
      </Defs>

      {/* Tile */}
      <Rect x={15} y={15} width={70} height={70} rx={18} fill={`url(#${gradientId})`} />
      {/* Filmstrip "M", holes punched through to the tile */}
      <Rect
        x={15}
        y={15}
        width={70}
        height={70}
        rx={18}
        fill="#FFFDF6"
        mask={`url(#${maskId})`}
      />
    </Svg>
  );
}
