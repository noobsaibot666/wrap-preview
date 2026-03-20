import React, { useState, useRef, useEffect, useCallback } from 'react';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { 
  Plus, 
  Minus, 
  RotateCcw, 
  Play, 
  Pause, 
  FileDown, 
  Maximize2, 
  ChevronDown, 
  X,
  ShieldCheck,
  FolderOpen,
  LayoutGrid,
  Download,
  CopyCheck,
  PanelBottomClose,
  PanelBottomOpen
} from 'lucide-react';
import { open, save } from '@tauri-apps/plugin-dialog';
import { useFramePreview } from './framePreviewLogic';
import { RatioType, FramePreviewMedia, RATIO_VALUES, INITIAL_TRANSFORM } from '../../types/framePreview';
import { ProductionProject } from '../../types';
import {
  buildFrameExportFilename,
  exportFrameToPath,
  FramePreviewFormat,
  FramePreviewResolution
} from './framePreviewExport';

interface FramePreviewAppProps {
  project?: ProductionProject | null;
  onBack: () => void;
}

interface PreviewFrameRect {
  width: number;
  height: number;
  left: number;
  top: number;
}

interface FrameOffset {
  x: number;
  y: number;
}

type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw' | null;

interface RenderedFrameRect extends PreviewFrameRect {
  ratio: RatioType;
  scale: number;
}

interface FrameResizeSession {
  x: number;
  y: number;
  ratio: RatioType;
  startScale: number;
  startWidth: number;
  startHeight: number;
  centerX: number;
  centerY: number;
  handle: Exclude<ResizeHandle, null>;
}

type CompositionGuideKey =
  | 'none'
  | 'ruleOfThirds'
  | 'leadingLines'
  | 'goldenSpiral'
  | 'phiGrid'
  | 'ruleOfOdds'
  | 'negativeSpace'
  | 'symmetry'
  | 'dynamicSymmetry';

type SocialGuideKey =
  | 'none'
  | 'instagramFeed'
  | 'instagramReel'
  | 'linkedin'
  | 'facebook'
  | 'youtube'
  | 'tiktok';

const BROWSER_IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'svg', 'avif']);
const RAW_IMAGE_EXTENSIONS = new Set(['dng', 'cr2', 'cr3', 'nef', 'nrw', 'arw', 'srf', 'sr2', 'raf', 'rw2', 'orf', 'pef', 'srw', 'raw', 'rwl', 'iiq']);

function getFileExtension(path: string): string {
  const match = path.toLowerCase().match(/\.([^.\\/]+)$/);
  return match?.[1] ?? '';
}

function isImagePath(path: string): boolean {
  const extension = getFileExtension(path);
  return BROWSER_IMAGE_EXTENSIONS.has(extension) || RAW_IMAGE_EXTENSIONS.has(extension) || extension === 'tif' || extension === 'tiff' || extension === 'heic' || extension === 'heif';
}

function isBrowserReadableImagePath(path: string): boolean {
  return BROWSER_IMAGE_EXTENSIONS.has(getFileExtension(path));
}

function fitBox(ratio: number, maxWidth: number, maxHeight: number) {
  const safeWidth = Math.max(maxWidth, 1);
  const safeHeight = Math.max(maxHeight, 1);
  let width = safeWidth;
  let height = width / ratio;

  if (height > safeHeight) {
    height = safeHeight;
    width = height * ratio;
  }

  return { width, height };
}

function computePreviewLayout(ratios: number[], width: number, height: number): PreviewFrameRect[] {
  if (ratios.length === 0 || width <= 0 || height <= 0) {
    return [];
  }

  const insetX = Math.min(36, Math.max(20, width * 0.028));
  const insetY = Math.min(30, Math.max(18, height * 0.032));
  const usableWidth = Math.max(width - insetX * 2, 1);
  const usableHeight = Math.max(height - insetY * 2, 1);
  const gap = Math.min(24, Math.max(12, Math.min(usableWidth, usableHeight) * 0.025));

  if (ratios.length === 1) {
    const box = fitBox(ratios[0], usableWidth, usableHeight);
    return [{
      width: box.width,
      height: box.height,
      left: insetX + (usableWidth - box.width) / 2,
      top: insetY + (usableHeight - box.height) / 2
    }];
  }

  if (ratios.length === 2) {
    const rowHeight = Math.min(usableHeight, (usableWidth - gap) / (ratios[0] + ratios[1]));
    const firstWidth = ratios[0] * rowHeight;
    const secondWidth = ratios[1] * rowHeight;
    const totalWidth = firstWidth + gap + secondWidth;
    const leftOffset = insetX + (usableWidth - totalWidth) / 2;
    const topOffset = insetY + (usableHeight - rowHeight) / 2;

    return [
      { width: firstWidth, height: rowHeight, left: leftOffset, top: topOffset },
      { width: secondWidth, height: rowHeight, left: leftOffset + firstWidth + gap, top: topOffset }
    ];
  }

  const rightColumnWidth = (usableHeight - gap) / ((1 / ratios[1]) + (1 / ratios[2]));
  const secondHeight = rightColumnWidth / ratios[1];
  const thirdHeight = rightColumnWidth / ratios[2];
  const primaryMaxWidth = Math.max(usableWidth - gap - rightColumnWidth, usableWidth * 0.45);
  const primaryBox = fitBox(ratios[0], primaryMaxWidth, usableHeight);
  const totalWidth = primaryBox.width + gap + rightColumnWidth;
  const leftOffset = insetX + (usableWidth - totalWidth) / 2;
  const primaryTop = insetY + (usableHeight - primaryBox.height) / 2;
  const rightTop = insetY + (usableHeight - (secondHeight + gap + thirdHeight)) / 2;

  return [
    { width: primaryBox.width, height: primaryBox.height, left: leftOffset, top: primaryTop },
    { width: rightColumnWidth, height: secondHeight, left: leftOffset + primaryBox.width + gap, top: rightTop },
    { width: rightColumnWidth, height: thirdHeight, left: leftOffset + primaryBox.width + gap, top: rightTop + secondHeight + gap }
  ];
}

function resolveResizeHandle(clientX: number, clientY: number, rect: DOMRect): ResizeHandle {
  const edge = 10;
  const localX = clientX - rect.left;
  const localY = clientY - rect.top;
  const nearLeft = localX <= edge;
  const nearRight = rect.width - localX <= edge;
  const nearTop = localY <= edge;
  const nearBottom = rect.height - localY <= edge;

  if (nearTop && nearLeft) return 'nw';
  if (nearTop && nearRight) return 'ne';
  if (nearBottom && nearLeft) return 'sw';
  if (nearBottom && nearRight) return 'se';
  if (nearTop) return 'n';
  if (nearBottom) return 's';
  if (nearLeft) return 'w';
  if (nearRight) return 'e';
  return null;
}

function resizeCursor(handle: ResizeHandle): string | undefined {
  switch (handle) {
    case 'n':
    case 's':
      return 'ns-resize';
    case 'e':
    case 'w':
      return 'ew-resize';
    case 'ne':
    case 'sw':
      return 'nesw-resize';
    case 'nw':
    case 'se':
      return 'nwse-resize';
    default:
      return undefined;
  }
}

const ORIGINAL_RATIO_TINTS: Record<string, string> = {
  '16:9': '#8f7cff',
  '9:16': '#67d4ff',
  '1:1': '#7be0a5',
  '4:5': '#ffb86b',
  '3:5': '#ff8ca1',
  '4:3': '#ffd66b',
  '3:2': '#7cc0ff',
  '2.39:1': '#c7a2ff'
};

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const temp = y;
    y = x % y;
    x = temp;
  }
  return x || 1;
}

function getOriginalRatioLabel(width: number, height: number): string {
  const ratio = width / Math.max(height, 1);
  const commonRatios: Array<{ label: string; value: number }> = [
    { label: '16:9', value: 16 / 9 },
    { label: '9:16', value: 9 / 16 },
    { label: '1:1', value: 1 },
    { label: '4:5', value: 4 / 5 },
    { label: '3:5', value: 3 / 5 },
    { label: '4:3', value: 4 / 3 },
    { label: '3:2', value: 3 / 2 },
    { label: '2.39:1', value: 2.39 }
  ];
  const closest = commonRatios.reduce((best, candidate) => {
    const nextDistance = Math.abs(candidate.value - ratio);
    return nextDistance < best.distance ? { label: candidate.label, distance: nextDistance } : best;
  }, { label: '1:1', distance: Number.POSITIVE_INFINITY });

  if (closest.distance < 0.03) {
    return closest.label;
  }

  const reduced = gcd(width, height);
  return `${Math.round(width / reduced)}:${Math.round(height / reduced)}`;
}

function formatMediaSize(width: number, height: number): string {
  return `${width}×${height}`;
}

function safeNumber(value: number, fallback: number) {
  return Number.isFinite(value) ? value : fallback;
}

function safePositiveNumber(value: number, fallback: number) {
  return Math.max(safeNumber(value, fallback), 0.0001);
}

function getGuideViewBox(ratio: RatioType) {
  const ratioValue = safePositiveNumber(RATIO_VALUES[ratio], 1);
  if (ratioValue >= 1) {
    return { width: safePositiveNumber(100 * ratioValue, 100), height: 100 };
  }
  return { width: 100, height: safePositiveNumber(100 / ratioValue, 100) };
}

type SpiralSide = 'left' | 'top' | 'right' | 'bottom';

interface SpiralSquare {
  x: number;
  y: number;
  size: number;
  side: SpiralSide;
}

function sanitizeGuideDimension(value: number, fallback: number) {
  return Math.max(1, safePositiveNumber(value, fallback));
}

function buildQuarterArc(square: SpiralSquare) {
  const x = safeNumber(square.x, 0);
  const y = safeNumber(square.y, 0);
  const size = sanitizeGuideDimension(square.size, 1);

  switch (square.side) {
    case 'left':
      return `M ${x} ${y + size} A ${size} ${size} 0 0 1 ${x + size} ${y}`;
    case 'top':
      return `M ${x} ${y} A ${size} ${size} 0 0 1 ${x + size} ${y + size}`;
    case 'right':
      return `M ${x + size} ${y} A ${size} ${size} 0 0 1 ${x} ${y + size}`;
    case 'bottom':
      return `M ${x + size} ${y + size} A ${size} ${size} 0 0 1 ${x} ${y}`;
    default:
      return '';
  }
}

function buildGoldenSpiralGuide(width: number, height: number) {
  const safeWidth = sanitizeGuideDimension(width, 100);
  const safeHeight = sanitizeGuideDimension(height, 100);
  const phi = (1 + Math.sqrt(5)) / 2;
  const isLandscape = safeWidth >= safeHeight;
  const guideWidth = isLandscape
    ? Math.min(safeWidth, safeHeight * phi)
    : Math.min(safeWidth, safeHeight / phi);
  const guideHeight = isLandscape
    ? guideWidth / phi
    : Math.min(safeHeight, guideWidth * phi);
  const offsetX = (safeWidth - guideWidth) / 2;
  const offsetY = (safeHeight - guideHeight) / 2;
  const cycle: SpiralSide[] = isLandscape
    ? ['left', 'top', 'right', 'bottom']
    : ['top', 'right', 'bottom', 'left'];

  const squares: SpiralSquare[] = [];
  let remainder = {
    x: offsetX,
    y: offsetY,
    width: guideWidth,
    height: guideHeight
  };

  for (let index = 0; index < 12; index += 1) {
    const nextSize = Math.min(remainder.width, remainder.height);
    if (!Number.isFinite(nextSize) || nextSize < 0.75) {
      break;
    }

    const side = cycle[index % cycle.length];
    switch (side) {
      case 'left':
        squares.push({ x: remainder.x, y: remainder.y, size: nextSize, side });
        remainder = {
          x: remainder.x + nextSize,
          y: remainder.y,
          width: remainder.width - nextSize,
          height: remainder.height
        };
        break;
      case 'top':
        squares.push({ x: remainder.x, y: remainder.y, size: nextSize, side });
        remainder = {
          x: remainder.x,
          y: remainder.y + nextSize,
          width: remainder.width,
          height: remainder.height - nextSize
        };
        break;
      case 'right':
        squares.push({ x: remainder.x + remainder.width - nextSize, y: remainder.y, size: nextSize, side });
        remainder = {
          x: remainder.x,
          y: remainder.y,
          width: remainder.width - nextSize,
          height: remainder.height
        };
        break;
      case 'bottom':
        squares.push({ x: remainder.x, y: remainder.y + remainder.height - nextSize, size: nextSize, side });
        remainder = {
          x: remainder.x,
          y: remainder.y,
          width: remainder.width,
          height: remainder.height - nextSize
        };
        break;
    }

    if (remainder.width < 0.75 || remainder.height < 0.75) {
      break;
    }
  }

  const arcs = squares
    .map(buildQuarterArc)
    .filter(Boolean)
    .join(' ');

  return {
    offsetX,
    offsetY,
    guideWidth,
    guideHeight,
    squares,
    arcs
  };
}

function buildRectPath(x: number, y: number, width: number, height: number) {
  const safeX = safeNumber(x, 0);
  const safeY = safeNumber(y, 0);
  const safeWidth = sanitizeGuideDimension(width, 1);
  const safeHeight = sanitizeGuideDimension(height, 1);
  return `M ${safeX} ${safeY} H ${safeX + safeWidth} V ${safeY + safeHeight} H ${safeX} Z`;
}

function buildDiagonalSymmetryGuide(width: number, height: number) {
  const safeWidth = sanitizeGuideDimension(width, 100);
  const safeHeight = sanitizeGuideDimension(height, 100);
  const slope = safeHeight / safeWidth;
  const reciprocalHeight = safeHeight * 0.24;
  const reciprocalWidth = safeWidth * 0.24;

  return [
    `M 0 0 L ${safeWidth} ${safeHeight}`,
    `M ${safeWidth} 0 L 0 ${safeHeight}`,
    `M 0 ${reciprocalHeight} L ${safeWidth - reciprocalWidth} ${safeHeight}`,
    `M ${reciprocalWidth} 0 L ${safeWidth} ${safeHeight - reciprocalHeight}`,
    `M 0 ${safeHeight - reciprocalHeight} L ${safeWidth - reciprocalWidth} 0`,
    `M ${reciprocalWidth} ${safeHeight} L ${safeWidth} ${reciprocalHeight}`,
    `M ${safeWidth / 2} 0 L ${safeWidth / 2} ${safeHeight}`,
    `M 0 ${safeHeight / 2} L ${safeWidth} ${safeHeight / 2}`,
    `M 0 ${safeHeight * (0.5 - slope * 0.18)} L ${safeWidth * 0.18} 0`,
    `M ${safeWidth * 0.82} ${safeHeight} L ${safeWidth} ${safeHeight * (0.5 + slope * 0.18)}`
  ].join(' ');
}

const COMPOSITION_GUIDES: Array<{ key: CompositionGuideKey; label: string }> = [
  { key: 'none', label: 'None' },
  { key: 'ruleOfThirds', label: 'Rule of Thirds' },
  { key: 'leadingLines', label: 'Leading Lines' },
  { key: 'goldenSpiral', label: 'The Golden Ratio/Spiral' },
  { key: 'phiGrid', label: 'The Phi Grid' },
  { key: 'ruleOfOdds', label: 'Rule of Odds' },
  { key: 'negativeSpace', label: 'Negative Space' },
  { key: 'symmetry', label: 'Symmetry and Centering' },
  { key: 'dynamicSymmetry', label: 'Diagonal Lines/Dynamic Symmetry' }
];

const SOCIAL_GUIDES: Array<{ key: SocialGuideKey; label: string }> = [
  { key: 'none', label: 'None' },
  { key: 'instagramFeed', label: 'Instagram Feed' },
  { key: 'instagramReel', label: 'Instagram Reel' },
  { key: 'linkedin', label: 'LinkedIn' },
  { key: 'facebook', label: 'Facebook' },
  { key: 'youtube', label: 'YouTube' },
  { key: 'tiktok', label: 'TikTok' }
];

function getSocialGuideInsets(guide: SocialGuideKey) {
  switch (guide) {
    case 'instagramFeed':
      return { top: 8, right: 6, bottom: 16, left: 6 };
    case 'instagramReel':
      return { top: 14, right: 10, bottom: 22, left: 8 };
    case 'linkedin':
      return { top: 10, right: 6, bottom: 14, left: 6 };
    case 'facebook':
      return { top: 10, right: 7, bottom: 17, left: 7 };
    case 'youtube':
      return { top: 8, right: 6, bottom: 18, left: 6 };
    case 'tiktok':
      return { top: 16, right: 10, bottom: 24, left: 10 };
    default:
      return { top: 10, right: 8, bottom: 16, left: 8 };
  }
}

function getSocialGuideLines(guide: SocialGuideKey) {
  switch (guide) {
    case 'instagramFeed':
      return { top: [0.16], bottom: [0.18], sides: [], verticalCenter: false, horizontalCenter: false };
    case 'instagramReel':
      return { top: [0.12], bottom: [0.2], sides: [0.88], verticalCenter: false, horizontalCenter: true };
    case 'linkedin':
      return { top: [0.14], bottom: [0.16], sides: [], verticalCenter: false, horizontalCenter: false };
    case 'facebook':
      return { top: [0.15], bottom: [0.19], sides: [0.9], verticalCenter: false, horizontalCenter: false };
    case 'youtube':
      return { top: [0.12], bottom: [0.15], sides: [], verticalCenter: true, horizontalCenter: false };
    case 'tiktok':
      return { top: [0.12], bottom: [0.22], sides: [0.86], verticalCenter: false, horizontalCenter: true };
    default:
      return { top: [], bottom: [], sides: [], verticalCenter: false, horizontalCenter: false };
  }
}

function renderCompositionGuide(guide: CompositionGuideKey, ratio: RatioType) {
  const { width, height } = getGuideViewBox(ratio);
  const phi = (1 + Math.sqrt(5)) / 2;
  const safeWidth = sanitizeGuideDimension(width, 100);
  const safeHeight = sanitizeGuideDimension(height, 100);
  const phiA = safeWidth / (phi * phi);
  const phiB = safeWidth / phi;
  const phiY1 = safeHeight / (phi * phi);
  const phiY2 = safeHeight / phi;

  switch (guide) {
    case 'none':
      return null;
    case 'ruleOfThirds':
      return (
        <svg className="frame-preview-guide-svg composition" viewBox={`0 0 ${safeWidth} ${safeHeight}`} preserveAspectRatio="none">
          <line className="frame-preview-guide-emphasis" x1={safeWidth / 3} y1="0" x2={safeWidth / 3} y2={safeHeight} />
          <line className="frame-preview-guide-emphasis" x1={(safeWidth * 2) / 3} y1="0" x2={(safeWidth * 2) / 3} y2={safeHeight} />
          <line className="frame-preview-guide-emphasis" x1="0" y1={safeHeight / 3} x2={safeWidth} y2={safeHeight / 3} />
          <line className="frame-preview-guide-emphasis" x1="0" y1={(safeHeight * 2) / 3} x2={safeWidth} y2={(safeHeight * 2) / 3} />
        </svg>
      );
    case 'leadingLines':
      return (
        <svg className="frame-preview-guide-svg composition" viewBox={`0 0 ${safeWidth} ${safeHeight}`} preserveAspectRatio="none">
          <line className="frame-preview-guide-emphasis" x1="0" y1={safeHeight} x2={safeWidth * 0.52} y2={safeHeight * 0.34} />
          <line className="frame-preview-guide-emphasis" x1={safeWidth} y1={safeHeight} x2={safeWidth * 0.52} y2={safeHeight * 0.34} />
          <line x1={safeWidth * 0.18} y1={safeHeight} x2={safeWidth * 0.52} y2={safeHeight * 0.34} />
          <line x1={safeWidth * 0.82} y1={safeHeight} x2={safeWidth * 0.52} y2={safeHeight * 0.34} />
          <line x1="0" y1={safeHeight * 0.74} x2={safeWidth * 0.52} y2={safeHeight * 0.34} />
          <line x1={safeWidth} y1={safeHeight * 0.74} x2={safeWidth * 0.52} y2={safeHeight * 0.34} />
        </svg>
      );
    case 'goldenSpiral': {
      const golden = buildGoldenSpiralGuide(safeWidth, safeHeight);
      return (
        <svg className="frame-preview-guide-svg composition" viewBox={`0 0 ${safeWidth} ${safeHeight}`} preserveAspectRatio="none">
          <path d={buildRectPath(golden.offsetX, golden.offsetY, golden.guideWidth, golden.guideHeight)} />
          {golden.squares.map((square, index) => (
            <path key={index} d={buildRectPath(square.x, square.y, square.size, square.size)} />
          ))}
          <path className="frame-preview-guide-emphasis" d={golden.arcs} />
        </svg>
      );
    }
    case 'phiGrid':
      return (
        <svg className="frame-preview-guide-svg composition" viewBox={`0 0 ${safeWidth} ${safeHeight}`} preserveAspectRatio="none">
          <line className="frame-preview-guide-emphasis" x1={phiA} y1="0" x2={phiA} y2={safeHeight} />
          <line x1={phiB} y1="0" x2={phiB} y2={safeHeight} />
          <line className="frame-preview-guide-emphasis" x1="0" y1={phiY1} x2={safeWidth} y2={phiY1} />
          <line x1="0" y1={phiY2} x2={safeWidth} y2={phiY2} />
        </svg>
      );
    case 'ruleOfOdds':
      return (
        <svg className="frame-preview-guide-svg composition" viewBox={`0 0 ${safeWidth} ${safeHeight}`} preserveAspectRatio="none">
          <line className="frame-preview-guide-emphasis" x1={safeWidth * 0.2} y1={safeHeight * 0.36} x2={safeWidth * 0.2} y2={safeHeight * 0.68} />
          <line className="frame-preview-guide-emphasis" x1={safeWidth * 0.5} y1={safeHeight * 0.24} x2={safeWidth * 0.5} y2={safeHeight * 0.64} />
          <line className="frame-preview-guide-emphasis" x1={safeWidth * 0.8} y1={safeHeight * 0.4} x2={safeWidth * 0.8} y2={safeHeight * 0.72} />
          <line x1={safeWidth * 0.2} y1={safeHeight * 0.52} x2={safeWidth * 0.5} y2={safeHeight * 0.44} />
          <line x1={safeWidth * 0.5} y1={safeHeight * 0.44} x2={safeWidth * 0.8} y2={safeHeight * 0.56} />
        </svg>
      );
    case 'negativeSpace':
      return (
        <svg className="frame-preview-guide-svg composition" viewBox={`0 0 ${safeWidth} ${safeHeight}`} preserveAspectRatio="none">
          <line className="frame-preview-guide-emphasis" x1={safeWidth * 0.42} y1={safeHeight * 0.12} x2={safeWidth * 0.42} y2={safeHeight * 0.88} />
          <line x1={safeWidth * 0.12} y1={safeHeight * 0.12} x2={safeWidth * 0.12} y2={safeHeight * 0.88} />
          <line x1={safeWidth * 0.12} y1={safeHeight * 0.12} x2={safeWidth * 0.42} y2={safeHeight * 0.12} />
          <line x1={safeWidth * 0.12} y1={safeHeight * 0.88} x2={safeWidth * 0.42} y2={safeHeight * 0.88} />
        </svg>
      );
    case 'symmetry':
      return (
        <svg className="frame-preview-guide-svg composition" viewBox={`0 0 ${safeWidth} ${safeHeight}`} preserveAspectRatio="none">
          <line className="frame-preview-guide-emphasis" x1={safeWidth / 2} y1="0" x2={safeWidth / 2} y2={safeHeight} />
          <line x1="0" y1={safeHeight / 2} x2={safeWidth} y2={safeHeight / 2} />
        </svg>
      );
    case 'dynamicSymmetry':
      return (
        <svg className="frame-preview-guide-svg composition" viewBox={`0 0 ${safeWidth} ${safeHeight}`} preserveAspectRatio="none">
          <path d={buildDiagonalSymmetryGuide(safeWidth, safeHeight)} />
        </svg>
      );
    default:
      return null;
  }
}

function renderSocialGuide(guide: SocialGuideKey, ratio: RatioType) {
  if (guide === 'none') {
    return null;
  }

  const { width, height } = getGuideViewBox(ratio);
  const frameWidth = sanitizeGuideDimension(width, 100);
  const frameHeight = sanitizeGuideDimension(height, 100);
  const insets = getSocialGuideInsets(guide);
  const safeWidth = frameWidth - (frameWidth * insets.left) / 100 - (frameWidth * insets.right) / 100;
  const safeHeight = frameHeight - (frameHeight * insets.top) / 100 - (frameHeight * insets.bottom) / 100;
  const left = (frameWidth * insets.left) / 100;
  const top = (frameHeight * insets.top) / 100;
  const right = frameWidth - (frameWidth * insets.right) / 100;
  const bottom = frameHeight - (frameHeight * insets.bottom) / 100;
  const lineConfig = getSocialGuideLines(guide);

  return (
    <svg className="frame-preview-guide-svg social" viewBox={`0 0 ${frameWidth} ${frameHeight}`} preserveAspectRatio="none">
      <rect className="frame-preview-guide-emphasis" x={left} y={top} width={safeWidth} height={safeHeight} rx="2.5" />
      {lineConfig.top.map((position) => {
        const y = top + safeHeight * position;
        return <line key={`top-${position}`} x1={left} y1={y} x2={right} y2={y} />;
      })}
      {lineConfig.bottom.map((position) => {
        const y = bottom - safeHeight * position;
        return <line key={`bottom-${position}`} x1={left} y1={y} x2={right} y2={y} />;
      })}
      {lineConfig.sides.map((position) => {
        const x = left + safeWidth * position;
        return <line key={`side-${position}`} x1={x} y1={top} x2={x} y2={bottom} />;
      })}
      {lineConfig.verticalCenter ? (
        <line x1={frameWidth / 2} y1={top} x2={frameWidth / 2} y2={bottom} />
      ) : null}
      {lineConfig.horizontalCenter ? (
        <line x1={left} y1={frameHeight / 2} x2={right} y2={frameHeight / 2} />
      ) : null}
    </svg>
  );
}

export const FramePreviewApp: React.FC<FramePreviewAppProps> = ({ project, onBack }) => {
  void onBack;
  const {
    state,
    activeMedia,
    setMediaList,
    setActiveMedia,
    toggleMediaSelection,
    updateTransform,
    setVideoTime,
    clickRatio,
    toggleRatio,
    setMasterRatio,
    resetTransform
  } = useFramePreview();

  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isFrameDragging, setIsFrameDragging] = useState(false);
  const [isFrameResizing, setIsFrameResizing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [compositionMenuOpen, setCompositionMenuOpen] = useState(false);
  const [socialMenuOpen, setSocialMenuOpen] = useState(false);
  const [thumbnailsHidden, setThumbnailsHidden] = useState(false);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const dragStartRef = useRef<{ x: number; y: number; offX: number; offY: number; ratio: RatioType } | null>(null);
  const frameDragStartRef = useRef<{ x: number; y: number; startX: number; startY: number; ratio: RatioType } | null>(null);
  const frameResizeStartRef = useRef<FrameResizeSession | null>(null);
  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({});
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const compositionMenuRef = useRef<HTMLDivElement>(null);
  const socialMenuRef = useRef<HTMLDivElement>(null);
  const canvasStageRef = useRef<HTMLDivElement>(null);
  const [frameOffsets, setFrameOffsets] = useState<Record<string, FrameOffset>>({});
  const [frameScales, setFrameScales] = useState<Record<string, number>>({});
  const [hoverResizeHandles, setHoverResizeHandles] = useState<Record<string, ResizeHandle>>({});
  const getAssetUrl = useCallback((path: string) => convertFileSrc(path), []);
  const getMediaPreviewUrl = useCallback((media: FramePreviewMedia) => getAssetUrl(media.preview_path ?? media.file_path), [getAssetUrl]);

  // Initialize with some media or empty state
  useEffect(() => {
    // Phase 1 can load from project folder or manually
  }, [project?.id]);

  const readImageMetadata = useCallback((path: string, sourcePath?: string) => {
    return new Promise<Pick<FramePreviewMedia, 'width' | 'height' | 'duration_ms' | 'thumbnail_src'>>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve({
        width: image.naturalWidth || 1,
        height: image.naturalHeight || 1,
        duration_ms: 0,
        thumbnail_src: getAssetUrl(sourcePath ?? path)
      });
      image.onerror = () => reject(new Error(`Failed to load image metadata for ${path}`));
      image.src = getAssetUrl(path);
    });
  }, [getAssetUrl]);

  const ensureStillPreviewPath = useCallback(async (path: string) => {
    if (isBrowserReadableImagePath(path)) {
      return undefined;
    }

    return invoke<string>('generate_frame_preview_image_proxy', { path });
  }, []);

  const readVideoMetadata = useCallback((path: string) => {
    return new Promise<Pick<FramePreviewMedia, 'width' | 'height' | 'duration_ms' | 'thumbnail_src'>>((resolve, reject) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;
      video.src = getAssetUrl(path);

      video.onloadedmetadata = () => {
        const seekTarget = Number.isFinite(video.duration) ? Math.min(video.duration * 0.1, Math.max(video.duration - 0.05, 0)) : 0;
        video.currentTime = seekTarget;
      };

      video.onseeked = () => {
        let thumbnail_src: string | undefined;

        try {
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(video.videoWidth, 1);
          canvas.height = Math.max(video.videoHeight, 1);
          const context = canvas.getContext('2d');
          if (context) {
            context.drawImage(video, 0, 0, canvas.width, canvas.height);
            thumbnail_src = canvas.toDataURL('image/jpeg', 0.82);
          }
        } catch (_error) {
          thumbnail_src = undefined;
        }

        resolve({
          width: video.videoWidth || 1920,
          height: video.videoHeight || 1080,
          duration_ms: Math.round((video.duration || 0) * 1000),
          thumbnail_src
        });
      };

      video.onerror = () => reject(new Error(`Failed to load video metadata for ${path}`));
    });
  }, [getAssetUrl]);

  const buildMediaEntry = useCallback(async (path: string): Promise<FramePreviewMedia> => {
    const filename = path.split(/[/\\]/).pop() || '';
    const isImage = isImagePath(path);
    const previewPath = isImage ? await ensureStillPreviewPath(path) : undefined;
    const renderPath = previewPath ?? path;
    const metadata = isImage ? await readImageMetadata(renderPath, renderPath) : await readVideoMetadata(path);

    return {
      id: crypto.randomUUID(),
      filename,
      file_path: path,
      preview_path: previewPath,
      width: metadata.width,
      height: metadata.height,
      duration_ms: metadata.duration_ms,
      status: 'ready',
      thumbnails: [],
      thumbnail_src: metadata.thumbnail_src,
      type: isImage ? 'image' : 'video'
    };
  }, [ensureStillPreviewPath, readImageMetadata, readVideoMetadata]);

  const handleAddMedia = async () => {
    const selected = await open({
      multiple: true,
      title: 'Select media for Frame Preview',
      filters: [{
        name: 'Media',
        extensions: ['mov', 'mp4', 'mxf', 'mkv', 'jpg', 'jpeg', 'png', 'webp', 'tif', 'tiff', 'heic', 'heif', 'dng', 'cr2', 'cr3', 'nef', 'nrw', 'arw', 'srf', 'sr2', 'raf', 'rw2', 'orf', 'pef', 'srw', 'raw', 'rwl', 'iiq']
      }]
    });

    if (!selected || !Array.isArray(selected)) return;

    const newMedia: FramePreviewMedia[] = await Promise.all(selected.map((path) => buildMediaEntry(path)));

    setMediaList([...state.mediaList, ...newMedia]);
  };

  const activeMediaState = activeMedia ? state.mediaStates[activeMedia.id] : undefined;
  const currentTransform = activeMediaState?.transforms[state.activeRatio] || INITIAL_TRANSFORM;
  const getTransform = useCallback((mediaId: string, ratio: RatioType) => {
    return state.mediaStates[mediaId]?.transforms[ratio] || INITIAL_TRANSFORM;
  }, [state.mediaStates]);
  const getSavedVideoTime = useCallback((mediaId: string) => {
    return state.mediaStates[mediaId]?.videoTimeSeconds ?? 0;
  }, [state.mediaStates]);
  const layoutRatios = state.masterRatio && state.visibleRatios.includes(state.masterRatio)
    ? [state.masterRatio, ...state.visibleRatios.filter((ratio) => ratio !== state.masterRatio)]
    : state.visibleRatios;
  const frameRects = computePreviewLayout(
    layoutRatios.map((ratio) => RATIO_VALUES[ratio]),
    canvasSize.width,
    canvasSize.height
  );
  const renderedFrameRectMap = layoutRatios.reduce<Record<string, RenderedFrameRect>>((acc, ratio, index) => {
    const rect = frameRects[index];
    const scale = frameScales[ratio] ?? 1;
    const offset = frameOffsets[ratio] || { x: 0, y: 0 };

    if (!rect) {
      acc[ratio] = {
        ratio,
        scale,
        width: 0,
        height: 0,
        left: 0,
        top: 0
      };
      return acc;
    }

    const scaledWidth = rect.width * scale;
    const scaledHeight = rect.height * scale;

    acc[ratio] = {
      ratio,
      scale,
      width: scaledWidth,
      height: scaledHeight,
      left: rect.left + offset.x - (scaledWidth - rect.width) / 2,
      top: rect.top + offset.y - (scaledHeight - rect.height) / 2
    };
    return acc;
  }, {});

  useEffect(() => {
    setFrameOffsets({});
    setFrameScales({});
    setHoverResizeHandles({});
  }, [state.visibleRatios.join('|')]);

  useEffect(() => {
    setIsPlaying(false);
    setProgress(0);
  }, [activeMedia?.id]);

  useEffect(() => {
    if (!exportMenuOpen && !compositionMenuOpen && !socialMenuOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (exportMenuRef.current && !exportMenuRef.current.contains(target)) {
        setExportMenuOpen(false);
      }
      if (compositionMenuRef.current && !compositionMenuRef.current.contains(target)) {
        setCompositionMenuOpen(false);
      }
      if (socialMenuRef.current && !socialMenuRef.current.contains(target)) {
        setSocialMenuOpen(false);
      }
    };

    window.addEventListener('mousedown', handlePointerDown);
    return () => window.removeEventListener('mousedown', handlePointerDown);
  }, [compositionMenuOpen, exportMenuOpen, socialMenuOpen]);

  useEffect(() => {
    const stage = canvasStageRef.current;
    if (!stage) return;

    const updateSize = () => {
      const nextWidth = Math.max(stage.clientWidth - 32, 0);
      const nextHeight = Math.max(stage.clientHeight - 32, 0);
      setCanvasSize({ width: nextWidth, height: nextHeight });
    };

    updateSize();

    const observer = new ResizeObserver(() => updateSize());
    observer.observe(stage);

    return () => observer.disconnect();
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent, ratio: RatioType) => {
    if (!activeMedia) return;
    const renderedRect = renderedFrameRectMap[ratio];
    const resizeHandle = hoverResizeHandles[ratio];
    if (renderedRect && resizeHandle) {
      setIsFrameDragging(false);
      setIsFrameResizing(true);
      frameResizeStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        ratio,
        startScale: renderedRect.scale,
        startWidth: renderedRect.width,
        startHeight: renderedRect.height,
        centerX: renderedRect.left + renderedRect.width / 2,
        centerY: renderedRect.top + renderedRect.height / 2,
        handle: resizeHandle
      };
      return;
    }
    const transform = getTransform(activeMedia.id, ratio);
    setIsDragging(true);
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      offX: transform.offsetX,
      offY: transform.offsetY,
      ratio
    };
  }, [activeMedia, getTransform, hoverResizeHandles, renderedFrameRectMap]);

  const startFrameDrag = useCallback((e: React.MouseEvent, ratio: RatioType) => {
    e.stopPropagation();
    clickRatio(ratio, false);
    const currentOffset = frameOffsets[ratio] || { x: 0, y: 0 };
    setIsDragging(false);
    setIsFrameResizing(false);
    setIsFrameDragging(true);
    frameDragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      startX: currentOffset.x,
      startY: currentOffset.y,
      ratio
    };
  }, [clickRatio, frameOffsets]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging || !dragStartRef.current || !activeMedia) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    
    updateTransform(activeMedia.id, dragStartRef.current.ratio, {
      offsetX: dragStartRef.current.offX + dx,
      offsetY: dragStartRef.current.offY + dy
    });
  }, [activeMedia, isDragging, updateTransform]);

  const handleFrameMouseMove = useCallback((e: MouseEvent) => {
    if (!isFrameDragging || !frameDragStartRef.current) return;

    const currentRect = frameDragStartRef.current?.ratio ? renderedFrameRectMap[frameDragStartRef.current.ratio] : null;
    if (!currentRect) return;

    const dx = e.clientX - frameDragStartRef.current.x;
    const dy = e.clientY - frameDragStartRef.current.y;
    const unclampedX = frameDragStartRef.current.startX + dx;
    const unclampedY = frameDragStartRef.current.startY + dy;
    const minX = -currentRect.left;
    const maxX = canvasSize.width - currentRect.left - currentRect.width;
    const minY = -currentRect.top;
    const maxY = canvasSize.height - currentRect.top - currentRect.height;

    setFrameOffsets((prev) => ({
      ...prev,
      [frameDragStartRef.current!.ratio]: {
        x: Math.min(Math.max(unclampedX, minX), maxX),
        y: Math.min(Math.max(unclampedY, minY), maxY)
      }
    }));
  }, [canvasSize.height, canvasSize.width, isFrameDragging, renderedFrameRectMap]);

  const handleFrameResizeMouseMove = useCallback((e: MouseEvent) => {
    if (!frameResizeStartRef.current) return;

    const session = frameResizeStartRef.current;
    const dx = e.clientX - session.x;
    const dy = e.clientY - session.y;
    const widthDelta = session.handle.includes('e') ? dx : (session.handle.includes('w') ? -dx : 0);
    const heightDelta = session.handle.includes('s') ? dy : (session.handle.includes('n') ? -dy : 0);

    const nextScaleFromWidth = widthDelta !== 0 ? (session.startWidth + widthDelta) / session.startWidth * session.startScale : null;
    const nextScaleFromHeight = heightDelta !== 0 ? (session.startHeight + heightDelta) / session.startHeight * session.startScale : null;
    const nextScale = Math.max(
      0.45,
      Math.min(
        nextScaleFromWidth && nextScaleFromHeight
          ? Math.max(nextScaleFromWidth, nextScaleFromHeight)
          : (nextScaleFromWidth ?? nextScaleFromHeight ?? session.startScale),
        Math.min(
          (2 * Math.min(session.centerX, canvasSize.width - session.centerX)) / Math.max(session.startWidth / session.startScale, 1),
          (2 * Math.min(session.centerY, canvasSize.height - session.centerY)) / Math.max(session.startHeight / session.startScale, 1),
          3
        )
      )
    );

    setFrameScales((prev) => ({
      ...prev,
      [session.ratio]: nextScale
    }));
  }, [canvasSize.height, canvasSize.width]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    setIsFrameDragging(false);
    setIsFrameResizing(false);
    dragStartRef.current = null;
    frameDragStartRef.current = null;
    frameResizeStartRef.current = null;
  }, []);

  useEffect(() => {
    if (isDragging || isFrameDragging || isFrameResizing) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mousemove', handleFrameMouseMove);
      window.addEventListener('mousemove', handleFrameResizeMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    } else {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mousemove', handleFrameMouseMove);
      window.removeEventListener('mousemove', handleFrameResizeMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mousemove', handleFrameMouseMove);
      window.removeEventListener('mousemove', handleFrameResizeMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, isFrameDragging, isFrameResizing, handleFrameMouseMove, handleFrameResizeMouseMove, handleMouseMove, handleMouseUp]);

  const handleWheel = useCallback((e: React.WheelEvent, ratio: RatioType) => {
    if (!activeMedia) return;
    e.preventDefault();
    const transform = getTransform(activeMedia.id, ratio);
    const delta = e.deltaY * -0.001;
    const nextScale = Math.min(Math.max(0.1, transform.scale + delta), 10);
    updateTransform(activeMedia.id, ratio, { scale: nextScale });
  }, [activeMedia, getTransform, updateTransform]);

  const activeVideoRef = state.activeRatio ? videoRefs.current[state.activeRatio] : null;

  useEffect(() => {
    const video = activeVideoRef;
    if (!video) {
      setProgress(0);
      return;
    }

    const updateProgress = () => {
      if (!video.duration) {
        setProgress(0);
        return;
      }
      setProgress((video.currentTime / video.duration) * 100);
      if (activeMedia) {
        setVideoTime(activeMedia.id, video.currentTime);
      }
    };

    video.addEventListener('timeupdate', updateProgress);
    video.addEventListener('loadedmetadata', updateProgress);

    return () => {
      video.removeEventListener('timeupdate', updateProgress);
      video.removeEventListener('loadedmetadata', updateProgress);
    };
  }, [activeMedia, activeVideoRef, setVideoTime, state.activeRatio]);

  useEffect(() => {
    if (!activeMedia || activeMedia.type !== 'video') return;

    const desiredTime = getSavedVideoTime(activeMedia.id);

    state.visibleRatios.forEach((ratio) => {
      const video = videoRefs.current[ratio];
      if (!video) return;

      const syncTime = () => {
        if (!video.duration) return;
        const safeTime = Math.min(Math.max(desiredTime, 0), Math.max(video.duration - 0.05, 0));
        if (Math.abs(video.currentTime - safeTime) > 0.05) {
          video.currentTime = safeTime;
        }
      };

      if (video.readyState >= 1) {
        syncTime();
      } else {
        video.addEventListener('loadedmetadata', syncTime, { once: true });
      }
    });
  }, [activeMedia, getSavedVideoTime, state.visibleRatios]);

  const toggleVideoPlayback = () => {
    const nextIsPlaying = !isPlaying;
    state.visibleRatios.forEach((ratio) => {
      const video = videoRefs.current[ratio];
      if (!video) return;
      if (nextIsPlaying) {
        void video.play();
      } else {
        video.pause();
      }
    });
    setIsPlaying(nextIsPlaying);
  };

  const handleVideoScrub = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!activeMedia) return;
    const val = parseFloat(e.target.value);
    state.visibleRatios.forEach((ratio) => {
      const video = videoRefs.current[ratio];
      if (!video || !video.duration) return;
      video.currentTime = (val / 100) * video.duration;
    });
    if (activeVideoRef?.duration) {
      setVideoTime(activeMedia.id, (val / 100) * activeVideoRef.duration);
    }
    setProgress(val);
  };

  const [exportRes] = useState<FramePreviewResolution>('1080p');
  const [exportFormat] = useState<FramePreviewFormat>('jpg');
  const [safeGuides, setSafeGuides] = useState<Record<string, boolean>>({});
  const [selectedCompositionGuide, setSelectedCompositionGuide] = useState<CompositionGuideKey>('phiGrid');
  const [selectedSocialGuide, setSelectedSocialGuide] = useState<SocialGuideKey>('none');

  const toggleSafeGuide = (ratio: RatioType) => {
    setSafeGuides(prev => ({ ...prev, [ratio]: !prev[ratio] }));
  };

  const copyTransform = (fromRatio: RatioType) => {
    if (!activeMedia) return;
    const transform = getTransform(activeMedia.id, fromRatio);
    if (!transform) return;
    
    state.visibleRatios.forEach(toRatio => {
        if (toRatio !== fromRatio) {
            updateTransform(activeMedia.id, toRatio, { ...transform });
        }
    });
  };

  const selectedExportRatios = state.selectedRatioIds.filter((ratio) => state.visibleRatios.includes(ratio));
  const activeVideoTimeSeconds = activeMedia ? getSavedVideoTime(activeMedia.id) : 0;

  const handleExportRatio = async (ratio: RatioType) => {
    if (!activeMedia) return;

    const filePath = await save({
      defaultPath: buildFrameExportFilename(activeMedia, ratio, exportFormat),
      filters: [{ name: 'Image', extensions: [exportFormat] }]
    });

    if (!filePath) return;

    setIsExporting(true);

    try {
      await exportFrameToPath(filePath, {
        media: activeMedia,
        ratio,
        transform: getTransform(activeMedia.id, ratio),
        resolution: exportRes,
        format: exportFormat,
        videoTimeSeconds: activeVideoTimeSeconds
      });
    } finally {
      setIsExporting(false);
      setExportMenuOpen(false);
    }
  };

  const handleExportSelectedFrames = async () => {
    if (!activeMedia || selectedExportRatios.length === 0) return;

    const selectedDirectory = await open({
      directory: true,
      multiple: false,
      title: 'Choose export folder for selected ratios'
    });

    if (!selectedDirectory || Array.isArray(selectedDirectory)) return;

    setIsExporting(true);

    try {
      for (const ratio of selectedExportRatios) {
        await exportFrameToPath(`${selectedDirectory}/${buildFrameExportFilename(activeMedia, ratio, exportFormat)}`, {
          media: activeMedia,
          ratio,
          transform: getTransform(activeMedia.id, ratio),
          resolution: exportRes,
          format: exportFormat,
          videoTimeSeconds: activeVideoTimeSeconds
        });
      }
    } finally {
      setIsExporting(false);
      setExportMenuOpen(false);
    }
  };

  const fitToFrame = useCallback((ratio: RatioType) => {
    if (!activeMedia) return;
    const renderedRect = renderedFrameRectMap[ratio];
    const frameWidth = Math.max((renderedRect?.width ?? 0) - 24, 1);
    const frameHeight = Math.max((renderedRect?.height ?? 0) - 54, 1);
    const containScale = Math.min(frameWidth / activeMedia.width, frameHeight / activeMedia.height);
    const coverScale = Math.max(frameWidth / activeMedia.width, frameHeight / activeMedia.height);
    const nextScale = containScale > 0 ? Math.max(1, coverScale / containScale) : 1;

    updateTransform(activeMedia.id, ratio, { scale: nextScale, offsetX: 0, offsetY: 0 });
  }, [activeMedia, renderedFrameRectMap, updateTransform]);

  const arrangeFrames = useCallback(() => {
    setFrameOffsets({});
    setFrameScales({});
    setHoverResizeHandles({});
  }, []);

  const handleFitButtonClick = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    if (event.shiftKey) {
      arrangeFrames();
      return;
    }
    fitToFrame(state.activeRatio);
  }, [arrangeFrames, fitToFrame, state.activeRatio]);

  const handleRatioChipClick = (ratio: RatioType, event: React.MouseEvent) => {
    const shouldAutoFitNewRatio = !event.shiftKey
      && !!activeMedia
      && !state.visibleRatios.includes(ratio)
      && !state.mediaStates[activeMedia.id]?.transforms[ratio];

    clickRatio(ratio, event.shiftKey);

    if (shouldAutoFitNewRatio) {
      fitToFrame(ratio);
    }
  };

  const activeGuideVisible = (ratio: RatioType) => safeGuides[ratio] && (selectedCompositionGuide !== 'none' || selectedSocialGuide !== 'none');

  return (
    <div className="frame-preview-app-container">
      {/* HEADER */}
      <header className="frame-preview-header premium-header">
        {activeMedia && (
          <>
            <div className="frame-preview-control-section ratios">
                <span className="frame-preview-control-label">Ratios</span>
                <div className="frame-preview-ratio-chips-group">
                    {(['16:9', '9:16', '1:1', '4:5', '3:5', '4:3', '2.39:1'] as RatioType[]).map(r => {
                        const isVisible = state.visibleRatios.includes(r);
                        const isActive = state.activeRatio === r;
                        const isSelected = state.selectedRatioIds.includes(r);
                        return (
                            <button 
                                key={r}
                                type="button"
                                className={`frame-preview-ratio-chip ${isVisible ? 'visible' : ''} ${isActive ? 'active' : ''} ${isSelected ? 'selected' : ''}`}
                                onClick={(event) => handleRatioChipClick(r, event)}
                            >
                                {r}
                            </button>
                        );
                    })}
                </div>
            </div>

            <div className="frame-preview-control-section guides">
                <span className="frame-preview-control-label">Guides</span>
                <div className="frame-preview-guide-menu" ref={compositionMenuRef}>
                    <button
                        type="button"
                        className="btn btn-ghost btn-xs"
                        onClick={() => {
                          setCompositionMenuOpen((open) => !open);
                          setSocialMenuOpen(false);
                        }}
                        aria-expanded={compositionMenuOpen}
                    >
                        <span>Composition</span> <ChevronDown size={14} />
                    </button>
                    {compositionMenuOpen ? (
                      <div className="frame-preview-guide-dropdown" role="menu">
                        {COMPOSITION_GUIDES.map((guide) => (
                          <button
                            key={guide.key}
                            className={`frame-preview-guide-item ${selectedCompositionGuide === guide.key ? 'active' : ''}`}
                            onClick={() => {
                              setSelectedCompositionGuide(guide.key);
                              setCompositionMenuOpen(false);
                            }}
                          >
                            {guide.label}
                          </button>
                        ))}
                      </div>
                    ) : null}
                </div>
                <div className="frame-preview-guide-menu" ref={socialMenuRef}>
                    <button
                        type="button"
                        className="btn btn-ghost btn-xs"
                        onClick={() => {
                          setSocialMenuOpen((open) => !open);
                          setCompositionMenuOpen(false);
                        }}
                        aria-expanded={socialMenuOpen}
                    >
                        <span>Social</span> <ChevronDown size={14} />
                    </button>
                    {socialMenuOpen ? (
                      <div className="frame-preview-guide-dropdown" role="menu">
                        {SOCIAL_GUIDES.map((guide) => (
                          <button
                            key={guide.key}
                            className={`frame-preview-guide-item ${selectedSocialGuide === guide.key ? 'active' : ''}`}
                            onClick={() => {
                              setSelectedSocialGuide(guide.key);
                              setSocialMenuOpen(false);
                            }}
                          >
                            {guide.label}
                          </button>
                        ))}
                      </div>
                    ) : null}
                </div>
            </div>

            <div className="frame-preview-control-section playback">
                {activeMedia.type === 'video' && (
                    <div className="frame-preview-playback-controls">
                        <button className="btn-icon" onClick={toggleVideoPlayback}>
                            {isPlaying ? <Pause size={18} /> : <Play size={18} />}
                        </button>
                        <input 
                            type="range" 
                            className="frame-preview-scrubber" 
                            min="0" max="100" 
                            value={progress} 
                            onChange={handleVideoScrub} 
                        />
                    </div>
                )}
            </div>

	            <div className="frame-preview-control-section transforms">
                <div className="frame-preview-zoom-group">
                    <button className="btn btn-ghost btn-xs" onClick={() => activeMedia && updateTransform(activeMedia.id, state.activeRatio, { scale: Math.max(0.1, currentTransform.scale - 0.1) })}><Minus size={14} /></button>
                    <span className="frame-preview-zoom-value">{Math.round(currentTransform.scale * 100)}%</span>
                    <button className="btn btn-ghost btn-xs" onClick={() => activeMedia && updateTransform(activeMedia.id, state.activeRatio, { scale: Math.min(10, currentTransform.scale + 0.1) })}><Plus size={14} /></button>
                </div>
                
                <div className="frame-preview-btn-group">
                    <button className="btn btn-ghost btn-xs" onClick={handleFitButtonClick} title="Fit to Frame. Shift-click to arrange all frames.">
                        <Maximize2 size={14} /> <span>Fit</span>
                    </button>
                    <button className="btn btn-ghost btn-xs" onClick={() => activeMedia && resetTransform(activeMedia.id, state.activeRatio)}>
                        <RotateCcw size={14} /> <span>Reset</span>
                    </button>
                    <button className="btn btn-ghost btn-xs" onClick={arrangeFrames} title="Arrange all visible frames">
                        <LayoutGrid size={14} /> <span>Arrange</span>
                    </button>
                    <div className="frame-preview-export-menu" ref={exportMenuRef}>
                        <button
                            className="btn btn-primary btn-xs"
                            onClick={() => setExportMenuOpen((open) => !open)}
                            disabled={isExporting}
                            aria-expanded={exportMenuOpen}
                            aria-haspopup="menu"
                        >
                            <Download size={14} /> <span>Export</span> <ChevronDown size={14} />
                        </button>
                        {exportMenuOpen ? (
                            <div className="frame-preview-export-dropdown" role="menu">
                                <button
                                    className="frame-preview-export-item"
                                    onClick={() => void handleExportRatio(state.activeRatio)}
                                    disabled={isExporting}
                                >
                                    <Download size={14} /> <span>Export Frame</span>
                                </button>
                                <button
                                    className="frame-preview-export-item"
                                    onClick={() => void handleExportSelectedFrames()}
                                    disabled={selectedExportRatios.length === 0 || isExporting}
                                >
                                    <FileDown size={14} /> <span>Export Selected</span>
                                </button>
                            </div>
                        ) : null}
                    </div>
                </div>
            </div>
          </>
        )}
      </header>

      {/* MAIN VIEWPORT */}
      <main className="frame-preview-main-viewport">
        <div className="frame-preview-canvas-stage" ref={canvasStageRef}>
            {activeMedia && state.visibleRatios.length > 0 ? (
                <div className="frame-preview-canvas-surface">
                    {state.visibleRatios.map((ratio) => {
                        const transform = activeMedia ? getTransform(activeMedia.id, ratio) : INITIAL_TRANSFORM;
                        const isRatioActive = state.activeRatio === ratio;
                        const isRatioSelected = state.selectedRatioIds.includes(ratio);
                        const isMaster = state.masterRatio === ratio;
                        const rect = renderedFrameRectMap[ratio];

                        if (!rect) {
                          return null;
                        }

                        return (
                            <div 
                                key={ratio}
                                id={`frame-${ratio}`}
                                className={`frame-preview-ratio-frame ${isRatioActive ? 'active' : ''} ${isRatioSelected ? 'selected' : ''}`}
                                style={{
                                  width: rect.width,
                                  height: rect.height,
                                  left: rect.left,
                                  top: rect.top,
                                  cursor: resizeCursor(hoverResizeHandles[ratio]) ?? ((isFrameDragging && frameDragStartRef.current?.ratio === ratio) ? 'move' : undefined)
                                }}
                                onMouseMove={(e) => {
                                    const bounds = e.currentTarget.getBoundingClientRect();
                                    const nextHandle = resolveResizeHandle(e.clientX, e.clientY, bounds);
                                    setHoverResizeHandles((prev) => prev[ratio] === nextHandle ? prev : { ...prev, [ratio]: nextHandle });
                                }}
                                onMouseLeave={() => {
                                    if (!frameResizeStartRef.current) {
                                      setHoverResizeHandles((prev) => prev[ratio] ? { ...prev, [ratio]: null } : prev);
                                    }
                                }}
                                onMouseDown={(e) => {
                                    clickRatio(ratio, e.shiftKey);
                                    handleMouseDown(e, ratio);
                                }}
                                onWheel={(e) => {
                                    clickRatio(ratio, false);
                                    handleWheel(e, ratio);
                                }}
                            >
                                <div className="frame-preview-frame-header">
                                    <div className="frame-preview-frame-label">
                                      {ratio}
                                      {isMaster ? <span className="frame-preview-master-badge">M</span> : null}
                                      {isRatioSelected ? <CopyCheck size={12} /> : null}
                                    </div>
                                    <div className="frame-preview-frame-header-actions">
                                        <button
                                            className="frame-preview-frame-drag-handle"
                                            onMouseDown={(e) => startFrameDrag(e, ratio)}
                                            title="Drag frame"
                                        />
                                        <button
                                            className={`frame-preview-btn-frame-action ${isMaster ? 'active master' : ''}`}
                                            onClick={(e) => { e.stopPropagation(); setMasterRatio(ratio); }}
                                            title={isMaster ? 'Unset Master Ratio' : 'Set Master Ratio'}
                                        >
                                            <span className="frame-preview-master-button-label">M</span>
                                        </button>
                                        <button 
                                            className={`frame-preview-btn-frame-action ${activeGuideVisible(ratio) ? 'active' : ''}`}
                                            onClick={(e) => { e.stopPropagation(); toggleSafeGuide(ratio); }}
                                            title="Show or hide selected guides"
                                        >
                                            <ShieldCheck size={12} />
                                        </button>
                                        <button 
                                            className="frame-preview-btn-frame-action"
                                            onClick={(e) => { e.stopPropagation(); copyTransform(ratio); }}
                                            title="Apply framing to all ratios"
                                        >
                                            <LayoutGrid size={12} />
                                        </button>
                                        <button
                                            className="frame-preview-btn-frame-action"
                                            onClick={(e) => { e.stopPropagation(); toggleRatio(ratio); }}
                                            title="Remove Ratio"
                                        >
                                            <X size={12} />
                                        </button>
                                    </div>
                                </div>
                                
                                <div className="frame-preview-media-mount" style={{
                                    transform: `translate(${transform.offsetX}px, ${transform.offsetY}px) scale(${transform.scale})`,
                                    transformOrigin: 'center'
                                }}>
                                    {activeMedia.type === 'video' ? (
                                        <video 
                                            key={`${activeMedia.id}-${ratio}`}
                                            ref={(node) => {
                                              videoRefs.current[ratio] = node;
                                            }}
                                            src={getAssetUrl(activeMedia.file_path)}
                                            muted
                                            loop
                                            playsInline
                                        />
                                    ) : (
                                        <img className="frame-preview-media-asset" src={getMediaPreviewUrl(activeMedia)} alt={activeMedia.filename} draggable={false} />
                                    )}
                                </div>

                                {safeGuides[ratio] ? (
                                    <div className={`frame-preview-safe-guide-overlay ratio-${ratio.replace(':', '-')}`}>
                                        {renderCompositionGuide(selectedCompositionGuide, ratio)}
                                        {renderSocialGuide(selectedSocialGuide, ratio)}
                                    </div>
                                ) : null}
                            </div>
                        );
                    })}
                </div>
            ) : (
                <div className="frame-preview-empty-state">
                    <LayoutGrid size={48} className="muted" />
                    <h2>{activeMedia ? 'No ratios visible' : 'No media loaded'}</h2>
                    <p>{activeMedia ? 'Click a ratio chip to add a new preview frame.' : 'Load images or videos to begin reframing for delivery.'}</p>
                    {!activeMedia ? (
                      <button className="btn btn-secondary" onClick={handleAddMedia}>
                          <FolderOpen size={16} /> <span>Load Media</span>
                      </button>
                    ) : null}
                </div>
            )}
        </div>
      </main>

      {/* FOOTER: CONTROL BAR + FILMSTRIP */}
      <footer className={`frame-preview-app-footer ${thumbnailsHidden ? 'is-collapsed' : ''}`}>
          <button
              className="frame-preview-thumbs-toggle"
              onClick={() => setThumbnailsHidden((hidden) => !hidden)}
              title={thumbnailsHidden ? 'Show Thumbnails' : 'Hide Thumbnails'}
              aria-label={thumbnailsHidden ? 'Show Thumbnails' : 'Hide Thumbnails'}
          >
              {thumbnailsHidden ? <PanelBottomOpen size={14} /> : <PanelBottomClose size={14} />}
          </button>
          <div className="frame-preview-filmstrip-scroll">
              <div className="frame-preview-filmstrip-inner">
                <button className="frame-preview-filmstrip-card add-btn" onClick={handleAddMedia}>
                    <Plus size={20} />
                </button>

                {state.mediaList.map(media => {
                    const isActive = media.id === state.activeMediaId;
                    const isSelected = state.selectedMediaIds.has(media.id);
                    const originalRatio = getOriginalRatioLabel(media.width, media.height);
                    const ratioTint = ORIGINAL_RATIO_TINTS[originalRatio] ?? 'var(--color-accent)';
                    return (
                        <div 
                            key={media.id} 
                            className={`frame-preview-filmstrip-card ${isActive ? 'active' : ''} ${isSelected ? 'selected' : ''}`}
                            style={{ ['--frame-preview-thumb-ratio' as string]: ratioTint }}
                            onClick={(e) => {
                                if (e.shiftKey || e.metaKey || e.ctrlKey) {
                                    toggleMediaSelection(media.id, true);
                                } else {
                                    setActiveMedia(media.id);
                                    toggleMediaSelection(media.id, false);
                                }
                            }}
                        >
                            <div className="frame-preview-card-thumb">
	                                {media.thumbnail_src ? (
	                                  <img
	                                    className="frame-preview-filmstrip-thumb"
	                                    src={media.thumbnail_src}
	                                    alt={media.filename}
	                                  />
	                                ) : null}
                                    <div className="frame-preview-thumb-ratio-badge">{originalRatio}</div>
                                    <div className="frame-preview-thumb-size">{formatMediaSize(media.width, media.height)}</div>
	                                {isSelected && <div className="frame-preview-selection-indicator"><ChevronDown size={14} /></div>}
	                            </div>
                        </div>
                    );
                })}
              </div>
          </div>
      </footer>
    </div>
  );
};
