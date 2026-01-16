import React, { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';

interface FileViewerModalProps {
  isOpen: boolean;
  onClose: () => void;
  filePath: string;
  action: 'created' | 'modified' | 'deleted' | 'read';
}

interface FileData {
  path: string;
  filename: string;
  extension: string;
  content: string;
  size: number;
  modified: string;
}

// Language mapping for syntax highlighting hints
const EXTENSION_LANGUAGES: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.py': 'python',
  '.rb': 'ruby',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.c': 'c',
  '.cpp': 'cpp',
  '.h': 'c',
  '.hpp': 'cpp',
  '.css': 'css',
  '.scss': 'scss',
  '.less': 'less',
  '.html': 'html',
  '.xml': 'xml',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.md': 'markdown',
  '.sql': 'sql',
  '.sh': 'bash',
  '.bash': 'bash',
  '.zsh': 'bash',
  '.fish': 'fish',
  '.ps1': 'powershell',
  '.dockerfile': 'dockerfile',
  '.toml': 'toml',
  '.ini': 'ini',
  '.env': 'bash',
  '.gitignore': 'gitignore',
};

const MARKDOWN_EXTENSIONS = ['.md', '.mdx', '.markdown'];

export function FileViewerModal({ isOpen, onClose, filePath, action }: FileViewerModalProps) {
  const [fileData, setFileData] = useState<FileData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && filePath) {
      loadFile();
    } else {
      setFileData(null);
      setError(null);
    }
  }, [isOpen, filePath]);

  const loadFile = async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`http://localhost:5174/api/files/read?path=${encodeURIComponent(filePath)}`);
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Failed to load file');
        return;
      }

      setFileData(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load file');
    } finally {
      setLoading(false);
    }
  };

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  };

  const getActionLabel = () => {
    switch (action) {
      case 'created': return 'Created';
      case 'modified': return 'Modified';
      case 'deleted': return 'Deleted';
      case 'read': return 'Read';
    }
  };

  const getActionColor = () => {
    switch (action) {
      case 'created': return 'var(--accent-green)';
      case 'modified': return 'var(--accent-orange)';
      case 'deleted': return 'var(--accent-red)';
      case 'read': return 'var(--text-secondary)';
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const isMarkdown = fileData && MARKDOWN_EXTENSIONS.includes(fileData.extension);
  const language = fileData ? EXTENSION_LANGUAGES[fileData.extension] || 'text' : 'text';

  if (!isOpen) return null;

  return (
    <div
      className="file-viewer-overlay"
      onClick={handleOverlayClick}
      onKeyDown={handleKeyDown}
      tabIndex={0}
    >
      <div className="file-viewer-modal">
        <div className="file-viewer-header">
          <div className="file-viewer-title">
            <span className="file-viewer-action" style={{ color: getActionColor() }}>
              {getActionLabel()}
            </span>
            <span className="file-viewer-filename">{fileData?.filename || filePath.split('/').pop()}</span>
          </div>
          <button className="file-viewer-close" onClick={onClose}>×</button>
        </div>

        <div className="file-viewer-path">
          {filePath}
        </div>

        {fileData && (
          <div className="file-viewer-meta">
            <span>{formatFileSize(fileData.size)}</span>
            <span>•</span>
            <span>{language}</span>
          </div>
        )}

        <div className="file-viewer-content">
          {loading && (
            <div className="file-viewer-loading">Loading file...</div>
          )}

          {error && (
            <div className="file-viewer-error">{error}</div>
          )}

          {fileData && !loading && !error && (
            isMarkdown ? (
              <div className="file-viewer-markdown markdown-content">
                <ReactMarkdown>{fileData.content}</ReactMarkdown>
              </div>
            ) : (
              <pre className="file-viewer-code">
                <code data-language={language}>{fileData.content}</code>
              </pre>
            )
          )}
        </div>
      </div>
    </div>
  );
}
