import { useRef, useState, useCallback, useEffect } from 'react';
import { Undo2, Trash2, Pen } from 'lucide-react';
import nacl from 'tweetnacl';

interface SoulArtCanvasProps {
  onArtComplete: (artHash: string, artData: string) => void;
  disabled?: boolean;
}

const CANVAS_SIZE = 256;
const MIN_STROKES = 3;
const MIN_DRAW_TIME_MS = 5000; // Must spend at least 5 seconds drawing
const COLORS = ['#ffffff', '#ff3b3b', '#3bff6f', '#3b9fff', '#ff3bef', '#ffdd3b', '#ff8c3b'];

/**
 * SoulArtCanvas — the proof of humanity drawing surface.
 * Users draw a small piece of art that gets hashed into their identity.
 * This is their "soul art" — revealed on the Void Wall if they're banned.
 */
export function SoulArtCanvas({ onArtComplete, disabled = false }: SoulArtCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [strokeCount, setStrokeCount] = useState(0);
  const [drawStartTime, setDrawStartTime] = useState<number | null>(null);
  const [totalDrawTime, setTotalDrawTime] = useState(0);
  const [currentColor, setCurrentColor] = useState('#ffffff');
  const [brushSize, setBrushSize] = useState(3);
  const [history, setHistory] = useState<ImageData[]>([]);
  const [isReady, setIsReady] = useState(false);

  // Initialize canvas with black background
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

    // Save initial state
    setHistory([ctx.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE)]);
  }, []);

  const getPos = useCallback((e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = CANVAS_SIZE / rect.width;
    const scaleY = CANVAS_SIZE / rect.height;

    if ('touches' in e) {
      const touch = e.touches[0];
      return {
        x: (touch.clientX - rect.left) * scaleX,
        y: (touch.clientY - rect.top) * scaleY,
      };
    }

    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }, []);

  const startDraw = useCallback((e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    e.preventDefault();

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;

    setIsDrawing(true);
    if (!drawStartTime) setDrawStartTime(Date.now());

    const { x, y } = getPos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.strokeStyle = currentColor;
    ctx.lineWidth = brushSize;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }, [disabled, drawStartTime, getPos, currentColor, brushSize]);

  const draw = useCallback((e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing || disabled) return;
    e.preventDefault();

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;

    const { x, y } = getPos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  }, [isDrawing, disabled, getPos]);

  const endDraw = useCallback(() => {
    if (!isDrawing) return;
    setIsDrawing(false);
    setStrokeCount(prev => prev + 1);

    if (drawStartTime) {
      setTotalDrawTime(Date.now() - drawStartTime);
    }

    // Save to history for undo
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (ctx) {
      setHistory(prev => [...prev, ctx.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE)]);
    }
  }, [isDrawing, drawStartTime]);

  const undo = useCallback(() => {
    if (history.length <= 1) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;

    const newHistory = history.slice(0, -1);
    const lastState = newHistory[newHistory.length - 1];
    ctx.putImageData(lastState, 0, 0);
    setHistory(newHistory);
    setStrokeCount(prev => Math.max(0, prev - 1));
    setIsReady(false);
  }, [history]);

  const clear = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    setStrokeCount(0);
    setDrawStartTime(null);
    setTotalDrawTime(0);
    setHistory([ctx.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE)]);
    setIsReady(false);
  }, []);

  // Check readiness
  useEffect(() => {
    const meetsRequirements = strokeCount >= MIN_STROKES && totalDrawTime >= MIN_DRAW_TIME_MS;
    setIsReady(meetsRequirements);
  }, [strokeCount, totalDrawTime]);

  const finalize = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas || !isReady) return;

    // Get canvas data as PNG data URL
    const artData = canvas.toDataURL('image/png');

    // Hash the canvas pixel data for the identity fingerprint
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const imageData = ctx.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    const fullHash = nacl.hash(new Uint8Array(imageData.data.buffer));
    // Take first 32 bytes for 64-char hex (SHA-256 equivalent length)
    const hashArray = Array.from(fullHash.slice(0, 32));
    const artHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    onArtComplete(artHash, artData);
  }, [isReady, onArtComplete]);

  const timeRemaining = Math.max(0, MIN_DRAW_TIME_MS - totalDrawTime);
  const strokesRemaining = Math.max(0, MIN_STROKES - strokeCount);

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative">
        <canvas
          ref={canvasRef}
          width={CANVAS_SIZE}
          height={CANVAS_SIZE}
          className="border border-gray-700 rounded-lg cursor-crosshair touch-none"
          style={{ width: '280px', height: '280px' }}
          onMouseDown={startDraw}
          onMouseMove={draw}
          onMouseUp={endDraw}
          onMouseLeave={endDraw}
          onTouchStart={startDraw}
          onTouchMove={draw}
          onTouchEnd={endDraw}
        />

        {/* Drawing hint overlay */}
        {strokeCount === 0 && !isDrawing && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-gray-500 text-sm text-center px-4">
              <Pen className="w-6 h-6 mx-auto mb-2 opacity-50" />
              <p>Draw your soul art</p>
              <p className="text-xs mt-1 opacity-60">This represents you in the Void</p>
            </div>
          </div>
        )}
      </div>

      {/* Color palette */}
      <div className="flex items-center gap-2">
        {COLORS.map(color => (
          <button
            key={color}
            className={`w-6 h-6 rounded-full border-2 transition-transform ${
              currentColor === color ? 'border-white scale-125' : 'border-gray-600'
            }`}
            style={{ backgroundColor: color }}
            onClick={() => setCurrentColor(color)}
            disabled={disabled}
          />
        ))}
        <span className="text-gray-500 mx-2">|</span>
        <input
          type="range"
          min="1"
          max="12"
          value={brushSize}
          onChange={(e) => setBrushSize(Number(e.target.value))}
          className="w-20 accent-purple-500"
          disabled={disabled}
        />
        <span className="text-xs text-gray-500">{brushSize}px</span>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3">
        <button
          onClick={undo}
          disabled={history.length <= 1 || disabled}
          className="flex items-center gap-1 px-3 py-1.5 text-sm bg-gray-800 text-gray-300 rounded hover:bg-gray-700 disabled:opacity-30 transition-colors"
        >
          <Undo2 className="w-3.5 h-3.5" />
          Undo
        </button>
        <button
          onClick={clear}
          disabled={strokeCount === 0 || disabled}
          className="flex items-center gap-1 px-3 py-1.5 text-sm bg-gray-800 text-gray-300 rounded hover:bg-gray-700 disabled:opacity-30 transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
          Clear
        </button>
      </div>

      {/* Progress indicators */}
      <div className="text-xs text-gray-500 text-center space-y-1">
        {strokesRemaining > 0 && (
          <p>{strokesRemaining} more stroke{strokesRemaining !== 1 ? 's' : ''} needed</p>
        )}
        {strokesRemaining <= 0 && timeRemaining > 0 && (
          <p>Keep drawing... {Math.ceil(timeRemaining / 1000)}s remaining</p>
        )}
        {isReady && (
          <p className="text-green-400">Ready to finalize</p>
        )}
      </div>

      {/* Finalize button */}
      <button
        onClick={finalize}
        disabled={!isReady || disabled}
        className="w-full py-2.5 px-4 bg-purple-600 text-white rounded-lg font-medium hover:bg-purple-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        Seal My Identity
      </button>
    </div>
  );
}
