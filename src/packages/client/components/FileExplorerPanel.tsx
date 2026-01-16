import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useStore, store } from '../store';
import Prism from 'prismjs';
import { DiffViewer } from './DiffViewer';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-tsx';
import 'prismjs/components/prism-css';
import 'prismjs/components/prism-scss';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-yaml';
import 'prismjs/components/prism-markdown';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-rust';
import 'prismjs/components/prism-go';
import 'prismjs/components/prism-sql';
import 'prismjs/components/prism-toml';
import 'prismjs/components/prism-docker';
import Fuse from 'fuse.js';

interface TreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  extension: string;
  children?: TreeNode[];
}

interface FileData {
  path: string;
  filename: string;
  extension: string;
  content: string;
  size: number;
  modified: string;
}

interface GitFileStatus {
  path: string;
  name: string;
  status: 'modified' | 'added' | 'deleted' | 'untracked' | 'renamed';
  oldPath?: string;
}

interface GitStatus {
  isGitRepo: boolean;
  branch?: string;
  files: GitFileStatus[];
  counts?: {
    modified: number;
    added: number;
    deleted: number;
    untracked: number;
    renamed: number;
  };
}

type ViewMode = 'files' | 'git';

interface FileExplorerPanelProps {
  isOpen: boolean;
  areaId: string | null;
  onClose: () => void;
}

// Extension to Prism language mapping
const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript',
  '.jsx': 'jsx',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.rs': 'rust',
  '.go': 'go',
  '.css': 'css',
  '.scss': 'scss',
  '.sass': 'scss',
  '.less': 'css',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.md': 'markdown',
  '.mdx': 'markdown',
  '.sql': 'sql',
  '.sh': 'bash',
  '.bash': 'bash',
  '.zsh': 'bash',
  '.fish': 'bash',
  '.toml': 'toml',
  '.dockerfile': 'docker',
  '.html': 'markup',
  '.xml': 'markup',
  '.svg': 'markup',
};

// File icons
const FILE_ICONS: Record<string, string> = {
  '.ts': '📘',
  '.tsx': '⚛️',
  '.js': '📒',
  '.jsx': '⚛️',
  '.py': '🐍',
  '.rs': '🦀',
  '.go': '🔷',
  '.md': '📝',
  '.json': '📋',
  '.yaml': '⚙️',
  '.yml': '⚙️',
  '.css': '🎨',
  '.scss': '🎨',
  '.html': '🌐',
  '.sql': '🗃️',
  '.sh': '💻',
  '.env': '🔐',
  '.toml': '⚙️',
  '.lock': '🔒',
  '.png': '🖼️',
  '.jpg': '🖼️',
  '.svg': '🖼️',
  '.gif': '🖼️',
  default: '📄',
};

function getFileIcon(node: TreeNode): string {
  if (node.isDirectory) return '';
  return FILE_ICONS[node.extension] || FILE_ICONS.default;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Tree Node Component
interface TreeNodeProps {
  node: TreeNode;
  depth: number;
  selectedPath: string | null;
  expandedPaths: Set<string>;
  onSelect: (node: TreeNode) => void;
  onToggle: (path: string) => void;
  searchQuery: string;
}

function TreeNodeItem({ node, depth, selectedPath, expandedPaths, onSelect, onToggle, searchQuery }: TreeNodeProps) {
  const isExpanded = expandedPaths.has(node.path);
  const isSelected = selectedPath === node.path;

  // Highlight matching text
  const highlightMatch = (text: string) => {
    if (!searchQuery) return text;
    const idx = text.toLowerCase().indexOf(searchQuery.toLowerCase());
    if (idx === -1) return text;
    return (
      <>
        {text.slice(0, idx)}
        <mark className="search-highlight">{text.slice(idx, idx + searchQuery.length)}</mark>
        {text.slice(idx + searchQuery.length)}
      </>
    );
  };

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (node.isDirectory) {
      onToggle(node.path);
    } else {
      onSelect(node);
    }
  };

  return (
    <div className="tree-node-wrapper">
      <div
        className={`tree-node ${isSelected ? 'selected' : ''} ${node.isDirectory ? 'directory' : 'file'}`}
        style={{ paddingLeft: `${12 + depth * 16}px` }}
        onClick={handleClick}
      >
        {node.isDirectory ? (
          <span className={`tree-arrow ${isExpanded ? 'expanded' : ''}`}>
            ▶
          </span>
        ) : (
          <span className="tree-icon">{getFileIcon(node)}</span>
        )}
        <span className="tree-name">{highlightMatch(node.name)}</span>
      </div>
      {node.isDirectory && isExpanded && node.children && (
        <div className="tree-children">
          {node.children.map((child) => (
            <TreeNodeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              expandedPaths={expandedPaths}
              onSelect={onSelect}
              onToggle={onToggle}
              searchQuery={searchQuery}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// File Viewer Component with Syntax Highlighting
interface FileViewerProps {
  file: FileData | null;
  loading: boolean;
  error: string | null;
}

function FileViewer({ file, loading, error }: FileViewerProps) {
  const codeRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (file && codeRef.current) {
      Prism.highlightElement(codeRef.current);
    }
  }, [file]);

  if (loading) {
    return <div className="file-viewer-placeholder">Loading...</div>;
  }

  if (error) {
    return <div className="file-viewer-placeholder error">{error}</div>;
  }

  if (!file) {
    return (
      <div className="file-viewer-placeholder">
        <div className="placeholder-icon">📂</div>
        <div className="placeholder-text">Select a file to view</div>
      </div>
    );
  }

  const language = EXTENSION_TO_LANGUAGE[file.extension] || 'plaintext';

  return (
    <div className="file-viewer-content">
      <div className="file-viewer-header">
        <span className="file-viewer-filename">{file.filename}</span>
        <span className="file-viewer-meta">
          {formatFileSize(file.size)} • {language}
        </span>
      </div>
      <div className="file-viewer-code-wrapper">
        <pre className="file-viewer-pre">
          <code ref={codeRef} className={`language-${language}`}>
            {file.content}
          </code>
        </pre>
      </div>
    </div>
  );
}

// Search Results Component
interface SearchResultsProps {
  results: TreeNode[];
  onSelect: (node: TreeNode) => void;
  selectedPath: string | null;
  query: string;
}

function SearchResults({ results, onSelect, selectedPath, query }: SearchResultsProps) {
  const highlightMatch = (text: string) => {
    if (!query) return text;
    const idx = text.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return text;
    return (
      <>
        {text.slice(0, idx)}
        <mark className="search-highlight">{text.slice(idx, idx + query.length)}</mark>
        {text.slice(idx + query.length)}
      </>
    );
  };

  return (
    <div className="search-results">
      {results.length === 0 ? (
        <div className="search-no-results">No files found</div>
      ) : (
        results.map((node) => (
          <div
            key={node.path}
            className={`search-result-item ${selectedPath === node.path ? 'selected' : ''}`}
            onClick={() => onSelect(node)}
          >
            <span className="search-result-icon">
              {node.isDirectory ? '📁' : getFileIcon(node)}
            </span>
            <div className="search-result-info">
              <span className="search-result-name">{highlightMatch(node.name)}</span>
              <span className="search-result-path">{node.path}</span>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// Git status icons and colors
const GIT_STATUS_CONFIG: Record<GitFileStatus['status'], { icon: string; color: string; label: string }> = {
  modified: { icon: 'M', color: '#ffb86c', label: 'Modified' },
  added: { icon: 'A', color: '#50fa7b', label: 'Added' },
  deleted: { icon: 'D', color: '#ff5555', label: 'Deleted' },
  untracked: { icon: 'U', color: '#8be9fd', label: 'Untracked' },
  renamed: { icon: 'R', color: '#bd93f9', label: 'Renamed' },
};

// Git Changes Component
interface GitChangesProps {
  gitStatus: GitStatus | null;
  loading: boolean;
  onFileSelect: (path: string, status: GitFileStatus['status']) => void;
  selectedPath: string | null;
  onRefresh: () => void;
}

function GitChanges({ gitStatus, loading, onFileSelect, selectedPath, onRefresh }: GitChangesProps) {
  if (loading) {
    return <div className="git-changes-loading">Loading git status...</div>;
  }

  if (!gitStatus || !gitStatus.isGitRepo) {
    return (
      <div className="git-changes-empty">
        <div className="git-empty-icon">📦</div>
        <div className="git-empty-text">Not a git repository</div>
      </div>
    );
  }

  if (gitStatus.files.length === 0) {
    return (
      <div className="git-changes-empty">
        <div className="git-empty-icon">✨</div>
        <div className="git-empty-text">Working tree clean</div>
        <div className="git-empty-branch">On branch {gitStatus.branch}</div>
      </div>
    );
  }

  // Group files by status
  const grouped = {
    modified: gitStatus.files.filter(f => f.status === 'modified'),
    added: gitStatus.files.filter(f => f.status === 'added'),
    deleted: gitStatus.files.filter(f => f.status === 'deleted'),
    renamed: gitStatus.files.filter(f => f.status === 'renamed'),
    untracked: gitStatus.files.filter(f => f.status === 'untracked'),
  };

  return (
    <div className="git-changes">
      <div className="git-changes-header">
        <span className="git-branch">
          <span className="git-branch-icon">⎇</span>
          {gitStatus.branch}
        </span>
        <button className="git-refresh-btn" onClick={onRefresh} title="Refresh">
          ↻
        </button>
      </div>

      <div className="git-changes-summary">
        {gitStatus.counts && (
          <>
            {gitStatus.counts.modified > 0 && (
              <span className="git-count modified">{gitStatus.counts.modified} modified</span>
            )}
            {gitStatus.counts.added > 0 && (
              <span className="git-count added">{gitStatus.counts.added} added</span>
            )}
            {gitStatus.counts.deleted > 0 && (
              <span className="git-count deleted">{gitStatus.counts.deleted} deleted</span>
            )}
            {gitStatus.counts.untracked > 0 && (
              <span className="git-count untracked">{gitStatus.counts.untracked} untracked</span>
            )}
          </>
        )}
      </div>

      <div className="git-changes-list">
        {Object.entries(grouped).map(([status, files]) => {
          if (files.length === 0) return null;
          const config = GIT_STATUS_CONFIG[status as GitFileStatus['status']];

          return (
            <div key={status} className="git-status-group">
              <div className="git-status-group-header" style={{ color: config.color }}>
                <span className="git-status-badge" style={{ background: config.color }}>
                  {config.icon}
                </span>
                {config.label} ({files.length})
              </div>
              {files.map((file) => (
                <div
                  key={file.path}
                  className={`git-file-item ${selectedPath === file.path ? 'selected' : ''}`}
                  onClick={() => file.status !== 'deleted' && onFileSelect(file.path, file.status)}
                  style={{ cursor: file.status === 'deleted' ? 'not-allowed' : 'pointer' }}
                >
                  <span className="git-file-status" style={{ color: config.color }}>
                    {config.icon}
                  </span>
                  <span className="git-file-name">{file.name}</span>
                  {file.oldPath && (
                    <span className="git-file-renamed">← {file.oldPath.split('/').pop()}</span>
                  )}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Main Component
export function FileExplorerPanel({ isOpen, areaId, onClose }: FileExplorerPanelProps) {
  const state = useStore();
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [treeLoading, setTreeLoading] = useState(false);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [selectedFile, setSelectedFile] = useState<FileData | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<TreeNode[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('files');
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);
  const [gitLoading, setGitLoading] = useState(false);
  const [originalContent, setOriginalContent] = useState<string | null>(null);
  const [selectedGitStatus, setSelectedGitStatus] = useState<GitFileStatus['status'] | null>(null);
  const [hasInitializedView, setHasInitializedView] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const area = areaId ? state.areas.get(areaId) : null;
  const directories = area?.directories || [];

  // Flatten tree for fuzzy search
  const flattenedFiles = useMemo(() => {
    const flatten = (nodes: TreeNode[]): TreeNode[] => {
      const result: TreeNode[] = [];
      for (const node of nodes) {
        result.push(node);
        if (node.children) {
          result.push(...flatten(node.children));
        }
      }
      return result;
    };
    return flatten(tree);
  }, [tree]);

  // Fuse.js instance for fuzzy search
  const fuse = useMemo(() => {
    return new Fuse(flattenedFiles, {
      keys: ['name', 'path'],
      threshold: 0.4,
      includeScore: true,
    });
  }, [flattenedFiles]);

  // Load tree for directories
  const loadTree = useCallback(async () => {
    if (directories.length === 0) return;

    setTreeLoading(true);
    const allTrees: TreeNode[] = [];

    for (const dir of directories) {
      try {
        const res = await fetch(`http://localhost:5174/api/files/tree?path=${encodeURIComponent(dir)}&depth=10`);
        const data = await res.json();
        if (res.ok && data.tree) {
          // Wrap in a root node for each directory
          allTrees.push({
            name: data.name,
            path: dir,
            isDirectory: true,
            size: 0,
            extension: '',
            children: data.tree,
          });
        }
      } catch (err) {
        console.error('[FileExplorer] Failed to load tree:', err);
      }
    }

    setTree(allTrees);
    setTreeLoading(false);

    // Auto-expand root directories
    setExpandedPaths(new Set(directories));
  }, [directories]);

  // Load git status for directories
  const loadGitStatus = useCallback(async () => {
    if (directories.length === 0) return;

    setGitLoading(true);

    // Use the first directory as the git repo root
    const dir = directories[0];

    try {
      const res = await fetch(`http://localhost:5174/api/files/git-status?path=${encodeURIComponent(dir)}`);
      const data = await res.json();

      if (res.ok) {
        setGitStatus(data);
      } else {
        setGitStatus({ isGitRepo: false, files: [] });
      }
    } catch (err) {
      console.error('[FileExplorer] Failed to load git status:', err);
      setGitStatus({ isGitRepo: false, files: [] });
    } finally {
      setGitLoading(false);
    }
  }, [directories]);

  // Load file content
  const loadFile = useCallback(async (filePath: string) => {
    setFileLoading(true);
    setFileError(null);
    setSelectedPath(filePath);

    try {
      const res = await fetch(`http://localhost:5174/api/files/read?path=${encodeURIComponent(filePath)}`);
      const data = await res.json();

      if (!res.ok) {
        setFileError(data.error || 'Failed to load file');
        setSelectedFile(null);
        return;
      }

      setSelectedFile(data);
    } catch (err: any) {
      setFileError(err.message || 'Failed to load file');
      setSelectedFile(null);
    } finally {
      setFileLoading(false);
    }
  }, []);

  // Handle search
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    const results = fuse.search(searchQuery).map(r => r.item).filter(n => !n.isDirectory).slice(0, 20);
    setSearchResults(results);
  }, [searchQuery, fuse]);

  // Load tree and git status when panel opens
  useEffect(() => {
    if (isOpen && directories.length > 0) {
      loadTree();
      // Also load git status to determine if we should show git tab by default
      loadGitStatus();
    }
  }, [isOpen, directories, loadTree, loadGitStatus]);

  // Listen for fileViewerPath from store (e.g., when clicking file link in terminal)
  useEffect(() => {
    if (state.fileViewerPath && isOpen) {
      loadFile(state.fileViewerPath);
      // Clear the path after loading
      store.clearFileViewerPath();
    }
  }, [state.fileViewerPath, isOpen, loadFile]);

  // Auto-select git tab if there are changes (only on initial load)
  useEffect(() => {
    if (!hasInitializedView && gitStatus && gitStatus.isGitRepo && gitStatus.files.length > 0) {
      setViewMode('git');
      setHasInitializedView(true);
    } else if (!hasInitializedView && gitStatus) {
      setHasInitializedView(true);
    }
  }, [gitStatus, hasInitializedView]);

  // Reset when area changes
  useEffect(() => {
    if (areaId) {
      setTree([]);
      setSelectedFile(null);
      setSelectedPath(null);
      setSearchQuery('');
      setExpandedPaths(new Set());
      setViewMode('files');
      setGitStatus(null);
      setOriginalContent(null);
      setSelectedGitStatus(null);
      setHasInitializedView(false);
    }
  }, [areaId]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        // If viewing a file, go back to file list
        if (selectedFile) {
          setSelectedFile(null);
          setSelectedPath(null);
          setSelectedGitStatus(null);
          setOriginalContent(null);
          return;
        }
        // If searching, clear search
        if (searchQuery) {
          setSearchQuery('');
          return;
        }
        // Otherwise close panel
        onClose();
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key === 'p') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, searchQuery, onClose, selectedFile]);

  const handleToggle = (path: string) => {
    setExpandedPaths(prev => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const handleGitFileSelect = async (path: string, status: GitFileStatus['status']) => {
    setSelectedGitStatus(status);
    setOriginalContent(null);

    // Load modified file
    await loadFile(path);

    // For modified files, also load the original from git
    if (status === 'modified') {
      try {
        const res = await fetch(`http://localhost:5174/api/files/git-original?path=${encodeURIComponent(path)}`);
        const data = await res.json();
        if (res.ok && !data.isNew) {
          setOriginalContent(data.content);
        }
      } catch (err) {
        console.error('[FileExplorer] Failed to load original file:', err);
      }
    }
  };

  // Clear git status when switching to files view or selecting from tree
  const handleSelect = (node: TreeNode) => {
    if (!node.isDirectory) {
      setSelectedGitStatus(null);
      setOriginalContent(null);
      loadFile(node.path);
    }
  };

  // Count git changes for tab badge
  const gitChangeCount = gitStatus?.files.length || 0;

  // Check if we're viewing a file (for full-width mode)
  const isViewingFile = selectedFile !== null;

  // Back to file list
  const handleBackToList = () => {
    setSelectedFile(null);
    setSelectedPath(null);
    setSelectedGitStatus(null);
    setOriginalContent(null);
  };

  if (!isOpen || !area) return null;

  return (
    <div className="file-explorer-panel ide-style">
      {/* Header */}
      <div className="file-explorer-panel-header">
        <div className="file-explorer-panel-title">
          {isViewingFile && (
            <button className="file-explorer-back-btn" onClick={handleBackToList} title="Back to file list">
              ←
            </button>
          )}
          <span className="file-explorer-panel-dot" style={{ background: area.color }} />
          <span>{area.name}</span>
          {isViewingFile && selectedFile && (
            <span className="file-explorer-current-file">/ {selectedFile.filename}</span>
          )}
        </div>
        <button className="file-explorer-panel-close" onClick={onClose}>×</button>
      </div>

      {/* Tab Bar (hidden when viewing file) */}
      {!isViewingFile && (
        <div className="file-explorer-tabs">
          <button
            className={`file-explorer-tab ${viewMode === 'files' ? 'active' : ''}`}
            onClick={() => setViewMode('files')}
          >
            <span className="tab-icon">📁</span>
            Files
          </button>
          <button
            className={`file-explorer-tab ${viewMode === 'git' ? 'active' : ''}`}
            onClick={() => setViewMode('git')}
          >
            <span className="tab-icon">⎇</span>
            Git Changes
            {gitChangeCount > 0 && (
              <span className="tab-badge">{gitChangeCount}</span>
            )}
          </button>
        </div>
      )}

      {/* Search Bar (only in files mode, hidden when viewing file) */}
      {!isViewingFile && viewMode === 'files' && (
        <div className="file-explorer-search">
          <input
            ref={searchInputRef}
            type="text"
            className="file-explorer-search-input"
            placeholder="Search files... (Cmd+P)"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button className="file-explorer-search-clear" onClick={() => setSearchQuery('')}>
              ×
            </button>
          )}
        </div>
      )}

      {/* Main Content */}
      <div className={`file-explorer-main ${isViewingFile ? 'full-width' : ''}`}>
        {/* Tree Panel (Left) - Hidden when viewing file */}
        {!isViewingFile && (
          <div className="file-explorer-tree-panel">
            {viewMode === 'files' ? (
              // Files View
              treeLoading ? (
                <div className="tree-loading">Loading...</div>
              ) : isSearching && searchQuery ? (
                <SearchResults
                  results={searchResults}
                  onSelect={handleSelect}
                  selectedPath={selectedPath}
                  query={searchQuery}
                />
              ) : (
                <div className="file-tree">
                  {tree.length === 0 ? (
                    <div className="tree-empty">No directories linked</div>
                  ) : (
                    tree.map((node) => (
                      <TreeNodeItem
                        key={node.path}
                        node={node}
                        depth={0}
                        selectedPath={selectedPath}
                        expandedPaths={expandedPaths}
                        onSelect={handleSelect}
                        onToggle={handleToggle}
                        searchQuery=""
                      />
                    ))
                  )}
                </div>
              )
            ) : (
              // Git Changes View
              <GitChanges
                gitStatus={gitStatus}
                loading={gitLoading}
                onFileSelect={handleGitFileSelect}
                selectedPath={selectedPath}
                onRefresh={loadGitStatus}
              />
            )}
          </div>
        )}

        {/* File Viewer (Right) - Full width when viewing file */}
        <div className="file-explorer-viewer-panel">
          {selectedGitStatus === 'modified' && originalContent !== null && selectedFile ? (
            <DiffViewer
              originalContent={originalContent}
              modifiedContent={selectedFile.content}
              filename={selectedFile.filename}
              language={EXTENSION_TO_LANGUAGE[selectedFile.extension] || 'plaintext'}
            />
          ) : (
            <FileViewer
              file={selectedFile}
              loading={fileLoading}
              error={fileError}
            />
          )}
        </div>
      </div>
    </div>
  );
}
