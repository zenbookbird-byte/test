import { useState } from 'react';
import {
  MousePointer2,
  ZoomIn,
  ZoomOut,
  Minus,
  TrendingUp,
  Square,
  Hash,
  Type,
  Eraser,
  Magnet,
  Lock,
  Settings,
} from 'lucide-react';
import clsx from 'clsx';

interface ToolDef {
  id: string;
  label: string;
  icon: React.ReactNode;
  separator?: false;
}

interface SeparatorDef {
  id: string;
  separator: true;
}

type ToolItem = ToolDef | SeparatorDef;

const TOOLS: ToolItem[] = [
  { id: 'crosshair',  label: 'Crosshair',        icon: <MousePointer2 size={14} /> },
  { id: 'zoom-in',   label: 'Zoom In',           icon: <ZoomIn size={14} /> },
  { id: 'zoom-out',  label: 'Zoom Out',          icon: <ZoomOut size={14} /> },
  { id: 'hline',     label: 'H-Line',            icon: <Minus size={14} /> },
  { id: 'trendline', label: 'Trend Line',        icon: <TrendingUp size={14} /> },
  { id: 'rectangle', label: 'Draw Rectangle',    icon: <Square size={14} /> },
  { id: 'fibonacci', label: 'Fibonacci',         icon: <Hash size={14} /> },
  { id: 'text',      label: 'Text Annotation',   icon: <Type size={14} /> },
  { id: 'eraser',    label: 'Eraser',            icon: <Eraser size={14} /> },
  { id: 'sep-1',     separator: true },
  { id: 'magnet',    label: 'Magnet Snap',       icon: <Magnet size={14} /> },
  { id: 'lock',      label: 'Lock Tools',        icon: <Lock size={14} /> },
  { id: 'settings',  label: 'Settings',          icon: <Settings size={14} /> },
];

export function ChartToolbar() {
  const [activeTool, setActiveTool] = useState<string | null>('crosshair');

  return (
    <div className="w-9 shrink-0 border-r border-ax-border bg-ax-sidebar flex flex-col items-center py-2 gap-0.5">
      {TOOLS.map((item) => {
        if ('separator' in item && item.separator) {
          return (
            <div
              key={item.id}
              className="w-5 h-px bg-ax-border my-1 shrink-0"
            />
          );
        }

        const tool = item as ToolDef;
        const isActive = activeTool === tool.id;

        return (
          <button
            key={tool.id}
            title={tool.label}
            onClick={() => setActiveTool(isActive ? null : tool.id)}
            className={clsx(
              'w-7 h-7 flex items-center justify-center rounded transition-colors text-xs shrink-0',
              isActive
                ? 'text-green-DEFAULT bg-green-dim'
                : 'text-text-muted hover:text-text-secondary hover:bg-ax-hover'
            )}
          >
            {tool.icon}
          </button>
        );
      })}
    </div>
  );
}
