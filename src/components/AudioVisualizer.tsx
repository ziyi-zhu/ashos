import { useEffect, useRef } from 'react';

interface AudioVisualizerProps {
  stream: MediaStream | null;
  className?: string;
}

export function AudioVisualizer({ stream, className = '' }: AudioVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number>(0);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (!stream || !canvasRef.current) return;

    audioContextRef.current = new AudioContext();
    analyserRef.current = audioContextRef.current.createAnalyser();
    analyserRef.current.fftSize = 256;
    
    const source = audioContextRef.current.createMediaStreamSource(stream);
    source.connect(analyserRef.current);
    
    const canvas = canvasRef.current;
    const canvasCtx = canvas.getContext('2d');
    if (!canvasCtx) return;
    
    const bufferLength = analyserRef.current.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    const draw = () => {
      if (!analyserRef.current || !canvasCtx) return;
      
      animationFrameRef.current = requestAnimationFrame(draw);
      analyserRef.current.getByteFrequencyData(dataArray);
      
      const width = canvas.width;
      const height = canvas.height;
      

      canvasCtx.clearRect(0, 0, width, height);
    
      const numPoints = Math.min(bufferLength, 24);
      const pointWidth = width / numPoints;
      
      canvasCtx.save();
      canvasCtx.filter = 'blur(15px)';
      canvasCtx.globalCompositeOperation = 'lighter';
      
      for (let layer = 0; layer < 3; layer++) {
        const layerOpacity = 0.4 - (layer * 0.1);
        const layerScale = 1 - (layer * 0.15);
        
        canvasCtx.beginPath();
        
        for (let i = 0; i <= numPoints; i++) {
          const binStart = Math.floor(i * bufferLength / numPoints);
          const binEnd = Math.floor((i + 1) * bufferLength / numPoints);
          
          let sum = 0;
          for (let j = binStart; j < binEnd; j++) {
            sum += dataArray[j];
          }
          
          const avg = sum / (binEnd - binStart || 1);
          const amplitude = (avg / 255) * height * 0.8 * layerScale;
          
          const sineOffset = Math.sin(i / numPoints * Math.PI * 2 + Date.now() / 2000) * 5;
          const finalHeight = amplitude + sineOffset;
          
          const x = i * pointWidth;
          const y = height - finalHeight;
          
          if (i === 0) {
            canvasCtx.moveTo(x, height);
            canvasCtx.lineTo(x, y);
          } else {
            const prevX = (i - 1) * pointWidth;
            const prevY = height - ((dataArray[Math.floor((i - 1) * bufferLength / numPoints)] / 255) * height * 0.8 * layerScale);
            
            const cpX1 = prevX + (x - prevX) / 3;
            const cpX2 = prevX + (x - prevX) * 2 / 3;
            
            canvasCtx.bezierCurveTo(
              cpX1, prevY,
              cpX2, y,
              x, y
            );
          }
        }
        
        canvasCtx.lineTo(width, height);
        canvasCtx.closePath();
        
        const bloomGradient = canvasCtx.createRadialGradient(
          width / 2, height / 2, 0,
          width / 2, height / 2, width / 2
        );
        
        bloomGradient.addColorStop(0, `rgba(255, 255, 255, ${layerOpacity})`);
        bloomGradient.addColorStop(0.5, `rgba(255, 255, 255, ${layerOpacity * 0.5})`);
        bloomGradient.addColorStop(1, `rgba(255, 255, 255, 0)`);
        
        canvasCtx.fillStyle = bloomGradient;
        canvasCtx.fill();
      }
      
      canvasCtx.restore();
    };
    
    draw();
    
    return () => {
      cancelAnimationFrame(animationFrameRef.current);
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, [stream]);
  
  return (
    <canvas 
      ref={canvasRef} 
      className={`audio-visualizer ${className}`} 
      width={500} 
      height={60}
    />
  );
} 