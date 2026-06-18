import React from 'react';
import Svg, { Path, Defs, LinearGradient, Stop, Rect } from 'react-native-svg';

interface LogoProps {
  size?: number;
}

export default function Logo({ size = 32 }: LogoProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" fill="none">
      <Defs>
        <LinearGradient id="logoGradient" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0%" stopColor="#FF7A50" />
          <Stop offset="50%" stopColor="#C837AB" />
          <Stop offset="100%" stopColor="#7F3FE7" />
        </LinearGradient>
      </Defs>
      {/* Background shape: rounded gradient square */}
      <Rect x={15} y={15} width={70} height={70} rx={18} fill="url(#logoGradient)" />
      
      {/* White 'M' graphic film strip */}
      <Path
        d="M26 34 C26 29.5, 29.5 26, 34 26 C38.5 26, 42 29.5, 42 34 V44 L50 54 L58 44 V34 C58 29.5, 61.5 26, 66 26 C70.5 26, 74 29.5, 74 34 V66 C74 70.5, 70.5 74, 66 74 C61.5 74, 58 70.5, 58 66 V56 L50 64 L42 56 V66 C42 70.5, 38.5 74, 34 74 C29.5 74, 26 70.5, 26 66 Z"
        fill="#FFFDF6"
      />
      
      {/* Left leg sprocket holes (cutouts showing gradient background) */}
      <Rect x={32} y={31} width={4} height={6} rx={1.5} fill="url(#logoGradient)" />
      <Rect x={32} y={41} width={4} height={6} rx={1.5} fill="url(#logoGradient)" />
      <Rect x={32} y={51} width={4} height={6} rx={1.5} fill="url(#logoGradient)" />
      <Rect x={32} y={61} width={4} height={6} rx={1.5} fill="url(#logoGradient)" />
      
      {/* Right leg sprocket holes (cutouts showing gradient background) */}
      <Rect x={64} y={31} width={4} height={6} rx={1.5} fill="url(#logoGradient)" />
      <Rect x={64} y={41} width={4} height={6} rx={1.5} fill="url(#logoGradient)" />
      <Rect x={64} y={51} width={4} height={6} rx={1.5} fill="url(#logoGradient)" />
      <Rect x={64} y={61} width={4} height={6} rx={1.5} fill="url(#logoGradient)" />
    </Svg>
  );
}
