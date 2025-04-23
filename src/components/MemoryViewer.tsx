import { Trash2 } from 'lucide-react';
import type { MemoryRecord } from '@/lib/memory';

interface MemoryViewerProps {
  isOpen: boolean;
  memories: MemoryRecord[];
  onDelete: (id: number) => void;
  isLoading: boolean;
}

export function MemoryViewer({ isOpen, memories, onDelete, isLoading }: MemoryViewerProps) {

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleString(); 
  };

  return (
    <div className={`memory-viewer ${isOpen ? 'open' : ''}`}>
      {isLoading ? (
        <div className="memory-loading">Loading memories...</div>
      ) : memories.length === 0 ? (
        <div className="memory-empty">No memories found.</div>
      ) : (
        <ul className="memory-list">
          {memories.map((memory) => (
            <li key={memory.id} className="memory-item">
              <div className="memory-item-content">
                <p className="memory-text">{memory.text}</p>
                <p className="memory-meta">
                  Added: {formatDate(memory.timestamp)}
                </p>
              </div>
              <button
                className="memory-delete-button"
                onClick={() => onDelete(memory.id)}
                title="Delete Memory"
              >
                <Trash2 size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
} 