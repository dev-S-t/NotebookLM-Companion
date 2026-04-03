'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import JSZip from 'jszip';
import { Upload, File as FileIcon, Folder, Download, CheckSquare, Square, ChevronRight, ChevronDown, Plus, RefreshCw, Eye, FileText, Trash2, Scissors, ClipboardPaste, ArrowLeft } from 'lucide-react';
import { motion } from 'motion/react';
import { parseGeminiChat, splitChat, formatChatToMarkdown, ChatSplitSettings, ParsedChat } from '../lib/chatParser';
import { CollapsibleTextarea } from './CollapsibleTextarea';

type FileNode = {
  name: string;
  path: string; // original relative path
  isDir: boolean;
  children: Record<string, FileNode>;
  file?: File;
  virtualContent?: string;
  selected: boolean;
  expanded: boolean;
};

const hasSelectedChildren = (node: FileNode): boolean => {
  if (node.selected && !node.isDir) return true;
  if (node.isDir) {
    return Object.values(node.children).some(hasSelectedChildren);
  }
  return false;
};

const TreeNodeView = ({ 
  node, 
  onToggleSelect, 
  onToggleExpand,
  onView,
  viewingPath
}: { 
  node: FileNode; 
  onToggleSelect: (path: string, selected: boolean) => void;
  onToggleExpand: (path: string) => void;
  onView: (node: FileNode) => void;
  viewingPath: string;
}) => {
  const isIndeterminate = node.isDir && !node.selected && hasSelectedChildren(node);
  const isActive = viewingPath === node.path;

  return (
    <div className="ml-3">
      <div 
        className={`flex items-center py-1.5 px-2 rounded-lg cursor-pointer transition-colors mb-0.5 ${
          isActive 
            ? 'bg-[#d3e3fd] dark:bg-[#004a77] text-[#041e49] dark:text-[#c2e7ff]' 
            : 'hover:bg-[#e1e3e1]/50 dark:hover:bg-[#333638]/50 text-[#444746] dark:text-[#e3e3e3]'
        }`}
        onClick={() => onView(node)}
      >
        {node.isDir ? (
          <button 
            onClick={(e) => { e.stopPropagation(); onToggleExpand(node.path); }} 
            className="p-1 -ml-1 mr-0.5 rounded-full hover:bg-black/5 dark:hover:bg-white/10"
          >
            {node.expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
        ) : (
          <span className="w-6 inline-block"></span>
        )}
        
        <button 
          onClick={(e) => { e.stopPropagation(); onToggleSelect(node.path, !node.selected); }}
          className={`mr-2 flex-shrink-0 ${isActive ? 'text-[#0b57d0] dark:text-[#a8c7fa]' : 'text-[#444746] dark:text-[#c4c7c5] hover:text-[#1f1f1f] dark:hover:text-[#e3e3e3]'}`}
        >
          {node.selected ? (
            <CheckSquare size={16} className={isActive ? '' : 'text-[#0b57d0] dark:text-[#a8c7fa]'} />
          ) : isIndeterminate ? (
            <div className={`w-4 h-4 border rounded flex items-center justify-center ${isActive ? 'border-[#0b57d0] dark:border-[#a8c7fa]' : 'border-[#444746] dark:border-[#c4c7c5]'}`}>
              <div className={`w-2 h-0.5 ${isActive ? 'bg-[#0b57d0] dark:bg-[#a8c7fa]' : 'bg-[#444746] dark:bg-[#c4c7c5]'}`}></div>
            </div>
          ) : (
            <Square size={16} />
          )}
        </button>

        {node.isDir ? (
          <Folder size={16} className={`mr-2 flex-shrink-0 ${isActive ? '' : 'text-[#444746] dark:text-[#c4c7c5]'}`} />
        ) : (
          <FileIcon size={16} className={`mr-2 flex-shrink-0 ${isActive ? '' : 'text-[#444746] dark:text-[#c4c7c5]'}`} />
        )}
        
        <span className="text-sm truncate select-none font-medium">{node.name}</span>
      </div>

      {node.isDir && node.expanded && (
        <div className="border-l border-[#e1e3e1] dark:border-[#333638] ml-3 pl-1">
          {Object.values(node.children)
            .sort((a, b) => {
              if (a.isDir && !b.isDir) return -1;
              if (!a.isDir && b.isDir) return 1;
              return a.name.localeCompare(b.name);
            })
            .map((child) => (
              <TreeNodeView 
                key={child.path} 
                node={child} 
                onToggleSelect={onToggleSelect} 
                onToggleExpand={onToggleExpand} 
                onView={onView}
                viewingPath={viewingPath}
              />
            ))}
        </div>
      )}
    </div>
  );
};

export default function FolderConverter() {
  const [activeTab, setActiveTab] = useState<'codebase' | 'clipboard' | 'chat'>('codebase');
  const [codebaseStep, setCodebaseStep] = useState(1);
  const [clipboardStep, setClipboardStep] = useState(1);
  const [chatStep, setChatStep] = useState(1);
  
  const [splitSettings, setSplitSettings] = useState<{
    enabled: boolean;
    mode: 'parts' | 'chars' | 'lines' | 'regex';
    value: number;
    overlap: number;
    overlapMode: 'chars' | 'lines';
    threshold: number;
    thresholdMode: 'chars' | 'lines';
    regexPattern: string;
  }>({
    enabled: false,
    mode: 'chars',
    value: 50000,
    overlap: 1000,
    overlapMode: 'chars',
    threshold: 50000,
    thresholdMode: 'chars',
    regexPattern: '^## ',
  });
  const [showSplitModal, setShowSplitModal] = useState(false);

  const [rootNode, setRootNode] = useState<FileNode | null>(null);
  const [originalFiles, setOriginalFiles] = useState<{file: File, path: string}[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  // Auto-advance codebase step when files are loaded
  useEffect(() => {
    if (originalFiles.length > 0 && codebaseStep === 1) {
      setCodebaseStep(2);
    }
  }, [originalFiles, codebaseStep]);
  
  const [clipboardText, setClipboardText] = useState('');
  const [clipboardFilename, setClipboardFilename] = useState('clipboard_export');
  
  const [chatText, setChatText] = useState('');
  const [chatPlatform, setChatPlatform] = useState('gemini');
  const [chatFilter, setChatFilter] = useState<'all' | 'human' | 'agent' | 'all3'>('all');
  const [chatFormat, setChatFormat] = useState<'md' | 'json' | 'json-md'>('md');
  const [showChatSplitModal, setShowChatSplitModal] = useState(false);
  const [chatSplitSettings, setChatSplitSettings] = useState<ChatSplitSettings>({
    enabled: false,
    mode: 'parts',
    value: 3,
    overlap: 0,
    startWith: 'any',
    endWith: 'any'
  });
  const chatFileInputRef = useRef<HTMLInputElement>(null);
  
  const [viewingNode, setViewingNode] = useState<FileNode | null>(null);
  const [previewContent, setPreviewContent] = useState<string>('');
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const getFilesFromDataTransfer = async (items: DataTransferItemList): Promise<{file: File, path: string}[]> => {
    const files: {file: File, path: string}[] = [];
    
    const readEntry = async (entry: any, path: string) => {
      if (entry.isFile) {
        const file = await new Promise<File>((resolve) => entry.file(resolve));
        files.push({ file, path: path + file.name });
      } else if (entry.isDirectory) {
        const dirReader = entry.createReader();
        let entries: any[] = [];
        
        const readAllEntries = async () => {
          let hasMore = true;
          while (hasMore) {
            const batch = await new Promise<any[]>((resolve, reject) => {
              dirReader.readEntries(resolve, reject);
            });
            if (batch.length === 0) {
              hasMore = false;
            } else {
              entries = entries.concat(batch);
            }
          }
        };
        
        await readAllEntries();
        
        for (const child of entries) {
          await readEntry(child, path + entry.name + '/');
        }
      }
    };

    const promises = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file') {
        const entry = item.webkitGetAsEntry();
        if (entry) {
          promises.push(readEntry(entry, ''));
        } else {
          const file = item.getAsFile();
          if (file) files.push({ file, path: file.name });
        }
      }
    }
    
    await Promise.all(promises);
    return files;
  };

  useEffect(() => {
    if (rootNode && !viewingNode) {
      setViewingNode(rootNode);
    }
  }, [rootNode, viewingNode]);

  const getTreeStates = (node: FileNode, states: Record<string, {selected: boolean, expanded: boolean}> = {}) => {
    states[node.path] = { selected: node.selected, expanded: node.expanded };
    if (node.isDir) {
      Object.values(node.children).forEach(child => getTreeStates(child, states));
    }
    return states;
  };

  const buildTreeFromFiles = async (fileList: {file: File, path: string}[], settings: typeof splitSettings) => {
    const prevStates = rootNode ? getTreeStates(rootNode) : {};
    
    const newRoot: FileNode = {
      name: 'root',
      path: '',
      isDir: true,
      children: {},
      selected: prevStates['']?.selected ?? true,
      expanded: prevStates['']?.expanded ?? true,
    };

    for (const { file, path } of fileList) {
      let isSplit = false;
      let chunks: string[] = [];
      
      if (settings.enabled) {
        try {
          if (!(settings.thresholdMode === 'chars' && file.size < settings.threshold)) {
            const text = await file.text();
            if (text.indexOf('\x00') === -1) {
              let thresholdExceeded = false;
              if (settings.thresholdMode === 'chars') {
                thresholdExceeded = text.length >= settings.threshold;
              } else {
                let lineCount = 1;
                for (let i = 0; i < text.length; i++) {
                  if (text[i] === '\n') lineCount++;
                }
                thresholdExceeded = lineCount >= settings.threshold;
              }
              
              if (thresholdExceeded) {
                chunks = splitText(text, settings);
                if (chunks.length > 1) {
                  isSplit = true;
                }
              }
            }
          }
        } catch (e) {
          console.error("Error reading file for split check", e);
        }
      }

      const pathParts = path.split('/').filter(Boolean);
      if (pathParts.length === 0) {
        if (isSplit) {
          const dirName = file.name;
          const dirPath = file.name;
          if (!newRoot.children[dirName]) {
            newRoot.children[dirName] = {
              name: dirName,
              path: dirPath,
              isDir: true,
              children: {},
              selected: prevStates[dirPath]?.selected ?? true,
              expanded: prevStates[dirPath]?.expanded ?? false,
            };
          }
          const dirNode = newRoot.children[dirName];
          const extension = file.name.split('.').pop() || '';
          const baseName = file.name.substring(0, file.name.length - extension.length - 1) || file.name;
          
          chunks.forEach((chunk, index) => {
            const partName = `${baseName}_part${index + 1}${extension ? '.' + extension : ''}`;
            const partPath = `${dirPath}/${partName}`;
            dirNode.children[partName] = {
              name: partName,
              path: partPath,
              isDir: false,
              children: {},
              selected: prevStates[partPath]?.selected ?? true,
              expanded: false,
              virtualContent: chunk,
            };
          });
        } else {
          if (!newRoot.children[file.name]) {
            newRoot.children[file.name] = {
              name: file.name,
              path: file.name,
              isDir: false,
              children: {},
              selected: prevStates[file.name]?.selected ?? true,
              expanded: false,
              file: file
            };
          }
        }
        continue;
      }

      let currentNode = newRoot;
      let currentPath = '';

      for (let i = 0; i < pathParts.length; i++) {
        const part = pathParts[i];
        const isLast = i === pathParts.length - 1;
        currentPath = currentPath ? `${currentPath}/${part}` : part;
        
        if (isLast && isSplit) {
          if (!currentNode.children[part]) {
            currentNode.children[part] = {
              name: part,
              path: currentPath,
              isDir: true,
              children: {},
              selected: prevStates[currentPath]?.selected ?? true,
              expanded: prevStates[currentPath]?.expanded ?? false,
            };
          }
          const dirNode = currentNode.children[part];
          const extension = part.split('.').pop() || '';
          const baseName = part.substring(0, part.length - extension.length - 1) || part;
          
          chunks.forEach((chunk, index) => {
            const partName = `${baseName}_part${index + 1}${extension ? '.' + extension : ''}`;
            const partPath = `${currentPath}/${partName}`;
            dirNode.children[partName] = {
              name: partName,
              path: partPath,
              isDir: false,
              children: {},
              selected: prevStates[partPath]?.selected ?? true,
              expanded: false,
              virtualContent: chunk,
            };
          });
        } else {
          if (!currentNode.children[part]) {
            currentNode.children[part] = {
              name: part,
              path: currentPath,
              isDir: !isLast,
              children: {},
              selected: prevStates[currentPath]?.selected ?? true,
              expanded: prevStates[currentPath]?.expanded ?? true,
              file: (isLast && !isSplit) ? file : undefined,
            };
          }
        }
        currentNode = currentNode.children[part];
      }
    }

    const updateParentStates = (node: FileNode): boolean => {
      if (!node.isDir) return node.selected;
      let allSelected = true;
      for (const child of Object.values(node.children)) {
        const childSelected = updateParentStates(child);
        if (!childSelected) allSelected = false;
      }
      node.selected = allSelected;
      return allSelected;
    };
    
    updateParentStates(newRoot);
    setRootNode(newRoot);
  };

  const addFilesToTree = async (fileList: {file: File, path: string}[]) => {
    if (fileList.length === 0) return;
    
    const newOriginalFiles = [...originalFiles, ...fileList];
    setOriginalFiles(newOriginalFiles);
    
    setIsProcessing(true);
    await buildTreeFromFiles(newOriginalFiles, splitSettings);
    setIsProcessing(false);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const fileList = files.map(f => ({
      file: f,
      path: f.webkitRelativePath || f.name
    }));
    addFilesToTree(fileList);
    e.target.value = '';
  };

  const toggleSelection = (node: FileNode, selected: boolean) => {
    node.selected = selected;
    if (node.isDir) {
      Object.values(node.children).forEach((child) => toggleSelection(child, selected));
    }
  };

  const updateSelection = (path: string, selected: boolean) => {
    if (!rootNode) return;
    const newRoot = { ...rootNode };
    
    const findAndToggle = (node: FileNode) => {
      if (node.path === path) {
        toggleSelection(node, selected);
        return true;
      }
      if (node.isDir) {
        for (const child of Object.values(node.children)) {
          if (findAndToggle(child)) return true;
        }
      }
      return false;
    };

    findAndToggle(newRoot);
    
    const updateParentStates = (node: FileNode): boolean => {
      if (!node.isDir) return node.selected;
      
      let allSelected = true;
      let anySelected = false;
      
      for (const child of Object.values(node.children)) {
        const childSelected = updateParentStates(child);
        if (!childSelected) allSelected = false;
        if (childSelected) anySelected = true;
      }
      
      node.selected = allSelected;
      return anySelected;
    };
    
    updateParentStates(newRoot);
    setRootNode(newRoot);
  };

  const toggleExpanded = (path: string) => {
    if (!rootNode) return;
    const newRoot = { ...rootNode };
    
    const findAndToggle = (node: FileNode) => {
      if (node.path === path) {
        node.expanded = !node.expanded;
        return true;
      }
      if (node.isDir) {
        for (const child of Object.values(node.children)) {
          if (findAndToggle(child)) return true;
        }
      }
      return false;
    };

    findAndToggle(newRoot);
    setRootNode(newRoot);
  };

  const generateHierarchyMd = useCallback((node: FileNode, depth: number = 0): string => {
    let md = '';
    const indent = '  '.repeat(depth);
    if (depth === 0) {
      md += `${indent}- **${node.name}/**\n`;
    } else {
      md += `${indent}- ${node.isDir ? `**${node.name}/**` : node.name}\n`;
    }

    if (node.isDir) {
      const sortedChildren = Object.values(node.children).sort((a, b) => {
        if (a.isDir && !b.isDir) return -1;
        if (!a.isDir && b.isDir) return 1;
        return a.name.localeCompare(b.name);
      });
      for (const child of sortedChildren) {
        if (child.selected || (child.isDir && hasSelectedChildren(child))) {
          md += generateHierarchyMd(child, depth + 1);
        }
      }
    }
    return md;
  }, []);

  useEffect(() => {
    if (!viewingNode) {
      setPreviewContent('');
      return;
    }

    setIsPreviewLoading(true);
    if (viewingNode.isDir) {
      const content = `# Folder Hierarchy: ${viewingNode.name}\n\n${generateHierarchyMd(viewingNode)}`;
      setPreviewContent(content);
      setIsPreviewLoading(false);
    } else if (viewingNode.virtualContent !== undefined) {
      setPreviewContent(viewingNode.virtualContent);
      setIsPreviewLoading(false);
    } else if (viewingNode.file) {
      viewingNode.file.text().then(text => {
        if (text.indexOf('\x00') !== -1) {
          setPreviewContent('// Binary file detected. Preview not available.');
        } else {
          setPreviewContent(text);
        }
        setIsPreviewLoading(false);
      }).catch(err => {
        setPreviewContent(`// Error reading file: ${err.message}`);
        setIsPreviewLoading(false);
      });
    }
  }, [viewingNode, rootNode, generateHierarchyMd]);

  const splitText = (text: string, settings: typeof splitSettings): string[] => {
    if (!settings.enabled || text.length < settings.threshold) return [text];
    
    const chunks: string[] = [];
    
    const getOverlapChars = (endIndex: number) => {
      if (settings.overlapMode === 'chars') return settings.overlap;
      if (settings.overlap <= 0) return 0;
      let linesFound = 0;
      let i = endIndex - 1;
      while (i >= 0 && linesFound < settings.overlap) {
        if (text[i] === '\n') linesFound++;
        i--;
      }
      return endIndex - 1 - i;
    };

    if (settings.mode === 'regex' && settings.regexPattern) {
      try {
        const regex = new RegExp(`(?=${settings.regexPattern})`, 'g');
        const parts = text.split(regex).filter(s => s.trim().length > 0);
        return parts.length > 0 ? parts : [text];
      } catch (e) {
        console.error("Invalid regex", e);
        return [text];
      }
    } else if (settings.mode === 'chars') {
      const chunkSize = settings.value;
      if (chunkSize <= 0) return [text];
      
      let i = 0;
      while (i < text.length) {
        const end = Math.min(i + chunkSize, text.length);
        chunks.push(text.slice(i, end));
        if (end === text.length) break;
        
        const overlapChars = getOverlapChars(end);
        const advance = chunkSize - overlapChars;
        i += advance > 0 ? advance : chunkSize;
      }
    } else if (settings.mode === 'lines') {
      const lines = text.split('\n');
      const chunkSize = settings.value;
      if (chunkSize <= 0) return [text];
      
      let i = 0;
      while (i < lines.length) {
        const end = Math.min(i + chunkSize, lines.length);
        chunks.push(lines.slice(i, end).join('\n'));
        if (end === lines.length) break;
        
        let overlapLinesCount = 0;
        if (settings.overlapMode === 'lines') {
          overlapLinesCount = settings.overlap;
        } else {
          let chars = 0;
          let j = end - 1;
          while (j >= i && chars < settings.overlap) {
            chars += lines[j].length + 1;
            overlapLinesCount++;
            j--;
          }
        }
        
        const advance = chunkSize - overlapLinesCount;
        i += advance > 0 ? advance : chunkSize;
      }
    } else if (settings.mode === 'parts') {
      const parts = settings.value;
      if (parts <= 1) return [text];
      
      const chunkSize = Math.ceil(text.length / parts);
      
      let i = 0;
      while (i < text.length) {
        const end = Math.min(i + chunkSize, text.length);
        const overlapChars = end < text.length ? getOverlapChars(end) : 0;
        chunks.push(text.slice(i, end + overlapChars));
        i = end;
      }
    }
    
    return chunks.length > 0 ? chunks : [text];
  };

  const handleConvert = async () => {
    if (!rootNode) return;
    setIsProcessing(true);

    try {
      const zip = new JSZip();
      const rootFolderName = rootNode.name;
      
      const hierarchyContent = `# File Hierarchy\n\n${generateHierarchyMd(rootNode)}`;
      zip.file(`${rootFolderName}/hierarchy.md`, hierarchyContent);

      const processNode = async (node: FileNode) => {
        if (!node.isDir && node.selected) {
          try {
            let text = '';
            let isBinary = false;
            
            if (node.virtualContent !== undefined) {
              text = node.virtualContent;
            } else if (node.file) {
              text = await node.file.text();
              if (text.indexOf('\x00') !== -1) {
                isBinary = true;
              }
            }
            
            if (isBinary) {
              console.warn(`Skipping binary file: ${node.name}`);
              return;
            }

            const extension = node.name.split('.').pop() || '';
            const safePath = node.path || node.name;
            const flattenedName = `${rootFolderName}/${safePath.replace(/\//g, '_')}.md`;
            
            const mdContent = `# File: ${rootFolderName}/${safePath}\n\n\`\`\`${extension}\n${text}\n\`\`\`\n`;
            zip.file(flattenedName, mdContent);
          } catch (err) {
            console.error(`Failed to read file: ${node.name}`, err);
          }
        } else if (node.isDir) {
          for (const child of Object.values(node.children)) {
            await processNode(child);
          }
        }
      };

      await processNode(rootNode);

      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${rootFolderName}_markdown.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

    } catch (error) {
      console.error('Error during conversion:', error);
      alert('An error occurred during conversion.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleReset = () => {
    setRootNode(null);
    setViewingNode(null);
    setPreviewContent('');
  };

  const tabs = [
    { id: 'codebase', label: 'Codebase' },
    { id: 'clipboard', label: 'Clipboard' },
    { id: 'chat', label: 'Chat Importer' }
  ] as const;

  return (
    <div className="flex flex-col h-screen w-full bg-[#f8fafd] dark:bg-[#131314] text-[#1f1f1f] dark:text-[#e3e3e3] font-sans overflow-hidden relative">
      {/* Header Area */}
      <header className="absolute top-0 left-0 right-0 h-24 flex items-center justify-between px-8 z-50 pointer-events-none">
        {/* Logo - Left */}
        <motion.div 
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5 }}
          className="flex items-center space-x-3 pointer-events-auto"
        >
          <div className="w-10 h-10 bg-gradient-to-br from-[#0b57d0] to-[#1a73e8] rounded-xl flex items-center justify-center shadow-md">
            <FileText className="text-white" size={22} />
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-[#1f1f1f] dark:text-[#e3e3e3]">
            NotebookLM Companion
          </h1>
        </motion.div>
        
        {/* Top Navigation Tabs - Center */}
        <motion.div 
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="absolute left-1/2 -translate-x-1/2 pointer-events-auto"
        >
          <div className="flex space-x-1 bg-white/80 dark:bg-[#1e1f20]/80 backdrop-blur-md p-1.5 rounded-full shadow-sm border border-[#e1e3e1] dark:border-[#333638]">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`relative px-6 py-2 rounded-full text-sm font-medium transition-colors z-10 ${
                  activeTab === tab.id 
                    ? 'text-[#0b57d0] dark:text-[#a8c7fa]' 
                    : 'text-[#444746] dark:text-[#c4c7c5] hover:text-[#1f1f1f] dark:hover:text-[#e3e3e3]'
                }`}
              >
                {activeTab === tab.id && (
                  <motion.div
                    layoutId="activeTab"
                    className="absolute inset-0 bg-[#f0f4f9] dark:bg-[#131314] rounded-full"
                    transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                    style={{ zIndex: -1 }}
                  />
                )}
                {tab.label}
              </button>
            ))}
          </div>
        </motion.div>
      </header>

      {/* Main Content Area */}
      <div className="flex-1 overflow-hidden relative pt-24">
        {activeTab === 'codebase' && (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="absolute inset-0 flex"
          >
            {!rootNode ? (
              <div className="flex-1 flex flex-col items-center justify-center p-8">
                <div className="text-center mb-8">
                  <h2 className="text-3xl font-semibold mb-4 text-[#1f1f1f] dark:text-[#e3e3e3]">Convert your Codebase</h2>
                  <p className="text-[#444746] dark:text-[#c4c7c5] text-lg max-w-xl mx-auto">
                    Upload your entire codebase or directory. We&apos;ll flatten it into Markdown files, perfectly formatted for NotebookLM and other AI tools.
                  </p>
                </div>

            <div 
              className={`mt-4 max-w-2xl w-full border-2 border-dashed rounded-3xl p-16 transition-all duration-300 bg-white dark:bg-[#1e1f20] shadow-sm ${
                isDragging 
                  ? 'border-[#0b57d0] bg-[#f0f4f9] dark:border-[#a8c7fa] dark:bg-[#004a77]/20 scale-[1.02]' 
                  : 'border-[#c7c7c7] dark:border-[#444746] hover:border-[#0b57d0] dark:hover:border-[#a8c7fa]'
              }`}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={async (e) => {
                e.preventDefault();
                setIsDragging(false);
                const items = e.dataTransfer.items;
                if (items) {
                  const files = await getFilesFromDataTransfer(items);
                  addFilesToTree(files);
                }
              }}
            >
              <Upload className={`mx-auto h-16 w-16 mb-6 ${isDragging ? 'text-[#0b57d0] dark:text-[#a8c7fa]' : 'text-[#444746] dark:text-[#c4c7c5]'}`} />
              <h3 className="text-xl font-medium mb-2">Drag & drop files or folders here</h3>
              <p className="text-[#444746] dark:text-[#c4c7c5] mb-8">All processing happens locally in your browser. Total privacy.</p>
              
              <div className="flex justify-center gap-4">
                <button 
                  onClick={() => folderInputRef.current?.click()}
                  className="px-8 py-3.5 bg-[#0b57d0] hover:bg-[#0842a0] text-white dark:bg-[#a8c7fa] dark:hover:bg-[#93b7f9] dark:text-[#041e49] rounded-full shadow-md font-medium transition-colors flex items-center text-base"
                >
                  <Folder size={20} className="mr-2" />
                  Select Folder
                </button>
                <button 
                  onClick={() => fileInputRef.current?.click()}
                  className="px-8 py-3.5 bg-white dark:bg-[#1e1f20] border border-[#e1e3e1] dark:border-[#333638] rounded-full shadow-sm hover:bg-[#f8fafd] dark:hover:bg-[#333638] font-medium transition-colors flex items-center text-base text-[#444746] dark:text-[#c4c7c5]"
                >
                  <FileIcon size={20} className="mr-2" />
                  Select Files
                </button>
              </div>
            </div>
          </div>
        ) : (
        <>
          {/* Left Sidebar - Sources */}
          <div className="w-80 flex flex-col bg-[#f8fafd] dark:bg-[#1e1f20] border-r border-[#e1e3e1] dark:border-[#333638] flex-shrink-0">
            <div className="p-4 border-b border-[#e1e3e1] dark:border-[#333638] flex justify-between items-center">
              <h2 className="text-lg font-medium flex items-center">
                <Folder className="mr-2 text-[#0b57d0] dark:text-[#a8c7fa]" size={20} />
                Sources
              </h2>
              <div className="flex space-x-1">
                <button 
                  onClick={() => fileInputRef.current?.click()}
                  className="p-2 text-[#444746] dark:text-[#c4c7c5] hover:bg-[#e1e3e1] dark:hover:bg-[#333638] rounded-full transition-colors"
                  title="Add Files"
                >
                  <FileIcon size={18} />
                </button>
                <button 
                  onClick={() => folderInputRef.current?.click()}
                  className="p-2 text-[#444746] dark:text-[#c4c7c5] hover:bg-[#e1e3e1] dark:hover:bg-[#333638] rounded-full transition-colors"
                  title="Add Folder"
                >
                  <Folder size={18} />
                </button>
                <button 
                  onClick={handleReset}
                  className="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-full transition-colors ml-1"
                  title="Clear All"
                >
                  <Trash2 size={18} />
                </button>
              </div>
            </div>
            
            <div className="flex-1 overflow-y-auto p-3 custom-scrollbar">
              <div className="-ml-3">
                <TreeNodeView 
                  node={rootNode} 
                  onToggleSelect={updateSelection} 
                  onToggleExpand={toggleExpanded} 
                  onView={setViewingNode}
                  viewingPath={viewingNode?.path || ''}
                />
              </div>
            </div>

            <div className="p-4 border-t border-[#e1e3e1] dark:border-[#333638] bg-white dark:bg-[#1e1f20]">
              <button
                onClick={() => setShowSplitModal(true)}
                className="w-full py-2 px-4 mb-3 bg-white dark:bg-[#1e1f20] border border-[#e1e3e1] dark:border-[#333638] hover:bg-[#f8fafd] dark:hover:bg-[#333638] rounded-full font-medium flex items-center justify-center transition-colors shadow-sm text-sm"
              >
                <Scissors size={16} className="mr-2" />
                Split Massive Files
              </button>
              <button
                onClick={handleConvert}
                disabled={isProcessing || !hasSelectedChildren(rootNode)}
                className="w-full py-3 px-4 bg-[#0b57d0] hover:bg-[#0842a0] disabled:bg-[#e1e3e1] disabled:text-[#444746] dark:disabled:bg-[#333638] dark:disabled:text-[#c4c7c5] text-white dark:bg-[#a8c7fa] dark:hover:bg-[#93b7f9] dark:text-[#041e49] rounded-full font-medium flex items-center justify-center transition-colors shadow-sm"
              >
                {isProcessing ? (
                  <>
                    <RefreshCw size={18} className="animate-spin mr-2" />
                    Processing...
                  </>
                ) : (
                  <>
                    <Download size={18} className="mr-2" />
                    Download Markdown
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Right Main Area - Studio/Preview */}
          <div className="flex-1 flex flex-col p-4 sm:p-6 overflow-hidden relative">
            <div className="flex-1 bg-white dark:bg-[#1e1f20] rounded-3xl border border-[#e1e3e1] dark:border-[#333638] overflow-hidden flex flex-col shadow-sm">
              
              {/* Preview Header */}
              <div className="px-6 py-4 border-b border-[#e1e3e1] dark:border-[#333638] flex items-center justify-between bg-white dark:bg-[#1e1f20] z-10">
                <div className="flex items-center space-x-3 overflow-hidden">
                  <div className="p-2 bg-[#f0f4f9] dark:bg-[#131314] rounded-lg flex-shrink-0">
                    {viewingNode?.isDir ? <Folder size={20} className="text-[#0b57d0] dark:text-[#a8c7fa]" /> : <FileText size={20} className="text-[#0b57d0] dark:text-[#a8c7fa]" />}
                  </div>
                  <h3 className="text-lg font-medium truncate">
                    {viewingNode ? viewingNode.name : 'Select a file to preview'}
                  </h3>
                </div>
                {viewingNode?.isDir && (
                  <span className="text-xs font-medium px-2.5 py-1 bg-[#e1e3e1] dark:bg-[#333638] text-[#444746] dark:text-[#c4c7c5] rounded-full flex-shrink-0">
                    Hierarchy Preview
                  </span>
                )}
              </div>

              {/* Preview Content */}
              <div className="flex-1 overflow-y-auto p-6 bg-[#f8fafd] dark:bg-[#131314] custom-scrollbar">
                {isPreviewLoading ? (
                  <div className="flex items-center justify-center h-full text-[#444746] dark:text-[#c4c7c5]">
                    <RefreshCw size={24} className="animate-spin mr-2" />
                    Loading preview...
                  </div>
                ) : viewingNode ? (
                  <pre className="text-sm font-mono whitespace-pre-wrap break-words text-[#1f1f1f] dark:text-[#e3e3e3] max-w-4xl mx-auto bg-white dark:bg-[#1e1f20] p-6 rounded-2xl border border-[#e1e3e1] dark:border-[#333638] shadow-sm">
                    {previewContent}
                  </pre>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-[#444746] dark:text-[#c4c7c5]">
                    <Eye size={48} className="mb-4 opacity-20" />
                    <p>Select a file or folder from the sources panel to preview its contents.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
            )}
          </motion.div>
        )}
        
        {activeTab === 'clipboard' && (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="absolute inset-0 flex flex-col"
          >
            {clipboardStep === 1 ? (
              <div className="flex-1 flex flex-col items-center justify-center p-8 max-w-4xl mx-auto w-full">
                <div className="text-center mb-8">
                  <h2 className="text-3xl font-semibold mb-4 text-[#1f1f1f] dark:text-[#e3e3e3]">Paste your Content</h2>
                  <p className="text-[#444746] dark:text-[#c4c7c5] text-lg">Paste massive amounts of text to convert and split into Markdown.</p>
                </div>
                
                <div className="w-full mb-6 flex justify-end">
                  <button
                    onClick={async () => {
                      try {
                        const text = await navigator.clipboard.readText();
                        setClipboardText(text);
                      } catch (err) {
                        console.error('Failed to read clipboard', err);
                      }
                    }}
                    className="flex items-center px-4 py-2 bg-white dark:bg-[#1e1f20] border border-[#e1e3e1] dark:border-[#333638] rounded-full shadow-sm hover:bg-[#f8fafd] dark:hover:bg-[#333638] font-medium transition-colors text-sm"
                  >
                    <ClipboardPaste size={16} className="mr-2" />
                    Paste from Clipboard
                  </button>
                </div>

                <CollapsibleTextarea 
                  value={clipboardText}
                  onChange={setClipboardText}
                  placeholder="Paste your massive text here..."
                  onNext={() => setClipboardStep(2)}
                  nextLabel="Configure Export"
                />
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center p-8 max-w-2xl mx-auto w-full">
                <div className="w-full flex items-center mb-8">
                  <button 
                    onClick={() => setClipboardStep(1)}
                    className="p-2 mr-4 rounded-full hover:bg-[#e1e3e1] dark:hover:bg-[#333638] transition-colors text-[#444746] dark:text-[#c4c7c5]"
                  >
                    <ArrowLeft size={20} />
                  </button>
                  <div>
                    <h2 className="text-2xl font-semibold text-[#1f1f1f] dark:text-[#e3e3e3]">Export Settings</h2>
                    <p className="text-[#444746] dark:text-[#c4c7c5]">Configure how your pasted content should be saved.</p>
                  </div>
                </div>

                <div className="w-full bg-white dark:bg-[#1e1f20] rounded-2xl border border-[#e1e3e1] dark:border-[#333638] p-8 shadow-sm space-y-8">
                  <div>
                    <label className="block text-sm font-medium mb-2 text-[#1f1f1f] dark:text-[#e3e3e3]">Filename</label>
                    <div className="flex items-center space-x-2">
                      <input 
                        type="text" 
                        value={clipboardFilename}
                        onChange={(e) => setClipboardFilename(e.target.value)}
                        placeholder="clipboard_export"
                        className="flex-1 p-3 rounded-xl border border-[#e1e3e1] dark:border-[#333638] bg-[#f8fafd] dark:bg-[#131314] focus:outline-none focus:ring-2 focus:ring-[#0b57d0]/20 font-mono text-sm"
                      />
                      <span className="text-[#444746] dark:text-[#c4c7c5] font-mono bg-[#f0f4f9] dark:bg-[#282a2c] px-3 py-3 rounded-xl border border-[#e1e3e1] dark:border-[#333638]">.md</span>
                    </div>
                  </div>

                  <div className="pt-6 border-t border-[#e1e3e1] dark:border-[#333638]">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h3 className="font-medium text-[#1f1f1f] dark:text-[#e3e3e3]">Smart Splitting</h3>
                        <p className="text-sm text-[#444746] dark:text-[#c4c7c5]">Automatically split large content into multiple files.</p>
                      </div>
                      <button
                        onClick={() => setShowSplitModal(true)}
                        className={`flex items-center px-4 py-2 rounded-full border transition-colors ${
                          splitSettings.enabled 
                            ? 'bg-[#d3e3fd] border-[#d3e3fd] text-[#041e49] dark:bg-[#004a77] dark:border-[#004a77] dark:text-[#c2e7ff]' 
                            : 'border-[#e1e3e1] dark:border-[#333638] text-[#444746] dark:text-[#c4c7c5] hover:bg-[#f8f9fa] dark:hover:bg-[#2a2b2d]'
                        }`}
                      >
                        <Scissors size={16} className="mr-2" />
                        <span className="text-sm font-medium">Configure {splitSettings.enabled ? '(On)' : ''}</span>
                      </button>
                    </div>
                  </div>

                  <div className="pt-8 flex justify-end">
                    <button
                      onClick={async () => {
                        if (!clipboardText.trim()) return;
                        setIsProcessing(true);
                        try {
                          const chunks = splitText(clipboardText, splitSettings);
                          const baseName = clipboardFilename.trim() || 'clipboard_export';
                          
                          if (chunks.length === 1) {
                            const blob = new Blob([chunks[0]], { type: 'text/markdown' });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = `${baseName}.md`;
                            document.body.appendChild(a);
                            a.click();
                            document.body.removeChild(a);
                            URL.revokeObjectURL(url);
                          } else {
                            const zip = new JSZip();
                            const folder = zip.folder(baseName);
                            chunks.forEach((chunk, index) => {
                              folder?.file(`${baseName}_part${index + 1}.md`, chunk);
                            });
                            
                            const content = await zip.generateAsync({ type: 'blob' });
                            const url = URL.createObjectURL(content);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = `${baseName}.zip`;
                            document.body.appendChild(a);
                            a.click();
                            document.body.removeChild(a);
                            URL.revokeObjectURL(url);
                          }
                        } catch (err) {
                          console.error("Failed to process clipboard text", err);
                        } finally {
                          setIsProcessing(false);
                        }
                      }}
                      disabled={!clipboardText.trim() || isProcessing}
                      className="flex items-center px-8 py-3.5 bg-[#0b57d0] text-white dark:bg-[#a8c7fa] dark:text-[#041e49] rounded-full font-medium hover:bg-[#0842a0] dark:hover:bg-[#93b7f9] transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-md text-base"
                    >
                      {isProcessing ? <RefreshCw size={20} className="mr-2 animate-spin" /> : <Download size={20} className="mr-2" />}
                      Download Markdown
                    </button>
                  </div>
                </div>
              </div>
            )}
          </motion.div>
        )}
        
        {activeTab === 'chat' && (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="absolute inset-0 flex flex-col"
          >
            {chatStep === 1 ? (
              <div className="flex-1 flex flex-col items-center justify-center p-8 max-w-4xl mx-auto w-full">
                <div className="text-center mb-8">
                  <h2 className="text-3xl font-semibold mb-4 text-[#1f1f1f] dark:text-[#e3e3e3]">Import Chat Conversation</h2>
                  <p className="text-[#444746] dark:text-[#c4c7c5] text-lg max-w-2xl mx-auto">
                    Keep scrolling up until you reach the start of your conversation, then press <kbd className="bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded text-sm border border-gray-200 dark:border-gray-700">Ctrl + A</kbd> and <kbd className="bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded text-sm border border-gray-200 dark:border-gray-700">Ctrl + C</kbd>. Paste it below.
                  </p>
                </div>
                
                <div className="w-full mb-6 flex justify-between items-center">
                  <div className="flex items-center space-x-3">
                    <input 
                      type="file" 
                      accept=".txt"
                      className="hidden" 
                      ref={chatFileInputRef}
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          const text = await file.text();
                          setChatText(text);
                        }
                        e.target.value = '';
                      }}
                    />
                    <button
                      onClick={() => chatFileInputRef.current?.click()}
                      className="flex items-center px-4 py-2 bg-white dark:bg-[#1e1f20] border border-[#e1e3e1] dark:border-[#333638] rounded-full shadow-sm hover:bg-[#f8fafd] dark:hover:bg-[#333638] font-medium transition-colors text-sm"
                    >
                      <Upload size={16} className="mr-2" />
                      Upload .txt
                    </button>
                  </div>
                  <button
                    onClick={async () => {
                      try {
                        const text = await navigator.clipboard.readText();
                        setChatText(text);
                      } catch (err) {
                        console.error('Failed to read clipboard', err);
                      }
                    }}
                    className="flex items-center px-4 py-2 bg-white dark:bg-[#1e1f20] border border-[#e1e3e1] dark:border-[#333638] rounded-full shadow-sm hover:bg-[#f8fafd] dark:hover:bg-[#333638] font-medium transition-colors text-sm"
                  >
                    <ClipboardPaste size={16} className="mr-2" />
                    Paste from Clipboard
                  </button>
                </div>

                <CollapsibleTextarea 
                  value={chatText}
                  onChange={setChatText}
                  placeholder="Paste your raw chat text here..."
                  onNext={() => setChatStep(2)}
                  nextLabel="Configure Export"
                />
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center p-8 max-w-2xl mx-auto w-full">
                <div className="w-full flex items-center mb-8">
                  <button 
                    onClick={() => setChatStep(1)}
                    className="p-2 mr-4 rounded-full hover:bg-[#e1e3e1] dark:hover:bg-[#333638] transition-colors text-[#444746] dark:text-[#c4c7c5]"
                  >
                    <ArrowLeft size={20} />
                  </button>
                  <div>
                    <h2 className="text-2xl font-semibold text-[#1f1f1f] dark:text-[#e3e3e3]">Export Settings</h2>
                    <p className="text-[#444746] dark:text-[#c4c7c5]">Configure how your chat should be parsed and saved.</p>
                  </div>
                </div>

                <div className="w-full bg-white dark:bg-[#1e1f20] rounded-2xl border border-[#e1e3e1] dark:border-[#333638] p-8 shadow-sm space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-medium mb-2 text-[#1f1f1f] dark:text-[#e3e3e3]">Platform</label>
                      <select 
                        value={chatPlatform}
                        onChange={(e) => setChatPlatform(e.target.value)}
                        className="w-full p-3 rounded-xl border border-[#e1e3e1] dark:border-[#333638] bg-[#f8fafd] dark:bg-[#131314] focus:outline-none focus:ring-2 focus:ring-[#0b57d0]/20"
                      >
                        <option value="gemini">Gemini</option>
                        <option value="custom" disabled>Custom (Coming Soon)</option>
                        <option value="grok" disabled>Grok (Coming Soon)</option>
                        <option value="aistudio" disabled>AI Studio (Coming Soon)</option>
                        <option value="chatgpt" disabled>ChatGPT (Coming Soon)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-2 text-[#1f1f1f] dark:text-[#e3e3e3]">Filter Messages</label>
                      <select 
                        value={chatFilter}
                        onChange={(e) => setChatFilter(e.target.value as any)}
                        className="w-full p-3 rounded-xl border border-[#e1e3e1] dark:border-[#333638] bg-[#f8fafd] dark:bg-[#131314] focus:outline-none focus:ring-2 focus:ring-[#0b57d0]/20"
                      >
                        <option value="all">Full Conversation</option>
                        <option value="human">User Only</option>
                        <option value="agent">Agent Only</option>
                        <option value="all3">All 3 (ZIP)</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-2 text-[#1f1f1f] dark:text-[#e3e3e3]">Output Format</label>
                    <select 
                      value={chatFormat}
                      onChange={(e) => setChatFormat(e.target.value as any)}
                      className="w-full p-3 rounded-xl border border-[#e1e3e1] dark:border-[#333638] bg-[#f8fafd] dark:bg-[#131314] focus:outline-none focus:ring-2 focus:ring-[#0b57d0]/20"
                    >
                      <option value="md">Markdown (.md)</option>
                      <option value="json">JSON (.json)</option>
                      <option value="json-md">JSON in Markdown (.md)</option>
                    </select>
                  </div>

                  <div className="pt-6 border-t border-[#e1e3e1] dark:border-[#333638]">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h3 className="font-medium text-[#1f1f1f] dark:text-[#e3e3e3]">Smart Splitting</h3>
                        <p className="text-sm text-[#444746] dark:text-[#c4c7c5]">Split chat while preserving message integrity.</p>
                      </div>
                      <button
                        onClick={() => setShowChatSplitModal(true)}
                        className={`flex items-center px-4 py-2 rounded-full border transition-colors ${
                          chatSplitSettings.enabled 
                            ? 'bg-[#d3e3fd] border-[#d3e3fd] text-[#041e49] dark:bg-[#004a77] dark:border-[#004a77] dark:text-[#c2e7ff]' 
                            : 'border-[#e1e3e1] dark:border-[#333638] text-[#444746] dark:text-[#c4c7c5] hover:bg-[#f8f9fa] dark:hover:bg-[#2a2b2d]'
                        }`}
                      >
                        <Scissors size={16} className="mr-2" />
                        <span className="text-sm font-medium">Configure {chatSplitSettings.enabled ? '(On)' : ''}</span>
                      </button>
                    </div>
                  </div>

                  <div className="pt-8 flex justify-end">
                    <button
                      onClick={async () => {
                        if (!chatText.trim()) return;
                        setIsProcessing(true);
                        try {
                          let parsed: ParsedChat;
                          if (chatPlatform === 'gemini') {
                            parsed = parseGeminiChat(chatText);
                          } else {
                            throw new Error("Platform not supported yet");
                          }

                          const chunks = splitChat(parsed, chatSplitSettings);
                          const baseName = parsed.title.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'chat_export';
                          
                          const getChunkContent = (chunk: ParsedChat, filter: 'all' | 'human' | 'agent', format: 'md' | 'json' | 'json-md'): string => {
                            if (format === 'md') return formatChatToMarkdown(chunk, filter);
                            
                            const filteredChunk = filter === 'all' ? chunk : {...chunk, conversation: chunk.conversation.filter(m => m.sender === filter)};
                            const jsonStr = JSON.stringify(filteredChunk, null, 2);
                            
                            if (format === 'json-md') {
                              return `# ${chunk.title}\n\n\`\`\`json\n${jsonStr}\n\`\`\`\n`;
                            }
                            return jsonStr;
                          };

                          const ext = chatFormat === 'json' ? 'json' : 'md';
                          
                          if (chatFilter === 'all3') {
                            const zip = new JSZip();
                            const folder = zip.folder(baseName);
                            
                            chunks.forEach((chunk, index) => {
                              const partSuffix = chunks.length > 1 ? `_part${index + 1}` : '';
                              
                              const allContent = getChunkContent(chunk, 'all', chatFormat);
                              const humanContent = getChunkContent(chunk, 'human', chatFormat);
                              const agentContent = getChunkContent(chunk, 'agent', chatFormat);
                              
                              folder?.file(`${baseName}${partSuffix}_combined.${ext}`, allContent);
                              folder?.file(`${baseName}${partSuffix}_user.${ext}`, humanContent);
                              folder?.file(`${baseName}${partSuffix}_agent.${ext}`, agentContent);
                            });
                            
                            const content = await zip.generateAsync({ type: 'blob' });
                            const url = URL.createObjectURL(content);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = `${baseName}_all3.zip`;
                            document.body.appendChild(a);
                            a.click();
                            document.body.removeChild(a);
                            URL.revokeObjectURL(url);
                          } else if (chunks.length === 1) {
                            const content = getChunkContent(chunks[0], chatFilter, chatFormat);
                            const blob = new Blob([content], { type: ext === 'md' ? 'text/markdown' : 'application/json' });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = `${baseName}.${ext}`;
                            document.body.appendChild(a);
                            a.click();
                            document.body.removeChild(a);
                            URL.revokeObjectURL(url);
                          } else {
                            const zip = new JSZip();
                            const folder = zip.folder(baseName);
                            chunks.forEach((chunk, index) => {
                              const content = getChunkContent(chunk, chatFilter, chatFormat);
                              folder?.file(`${baseName}_part${index + 1}.${ext}`, content);
                            });
                            
                            const content = await zip.generateAsync({ type: 'blob' });
                            const url = URL.createObjectURL(content);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = `${baseName}.zip`;
                            document.body.appendChild(a);
                            a.click();
                            document.body.removeChild(a);
                            URL.revokeObjectURL(url);
                          }
                        } catch (err) {
                          console.error("Failed to process chat text", err);
                          alert("Failed to process chat: " + (err as Error).message);
                        } finally {
                          setIsProcessing(false);
                        }
                      }}
                      disabled={!chatText.trim() || isProcessing}
                      className="flex items-center px-8 py-3.5 bg-[#0b57d0] text-white dark:bg-[#a8c7fa] dark:text-[#041e49] rounded-full font-medium hover:bg-[#0842a0] dark:hover:bg-[#93b7f9] transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-md text-base"
                    >
                      {isProcessing ? <RefreshCw size={20} className="mr-2 animate-spin" /> : <Download size={20} className="mr-2" />}
                      Download {chatFormat.toUpperCase()}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </div>

      {/* Split Modal */}
      {showSplitModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-[#1e1f20] rounded-2xl p-6 w-full max-w-md shadow-xl border border-[#e1e3e1] dark:border-[#333638]">
            <h3 className="text-xl font-semibold mb-4">Split Massive Files</h3>
            
            <div className="space-y-4">
              <label className="flex items-center space-x-2 cursor-pointer">
                <input 
                  type="checkbox" 
                  checked={splitSettings.enabled}
                  onChange={(e) => setSplitSettings(s => ({...s, enabled: e.target.checked}))}
                  className="rounded border-[#c7c7c7] dark:border-[#444746] text-[#0b57d0] focus:ring-[#0b57d0] w-4 h-4"
                />
                <span className="font-medium">Enable file splitting</span>
              </label>

              {splitSettings.enabled && (
                <div className="space-y-4 pt-2 border-t border-[#e1e3e1] dark:border-[#333638]">
                  <div>
                    <label className="block text-sm font-medium mb-1 text-[#444746] dark:text-[#c4c7c5]">
                      Minimum file size to split
                    </label>
                    <div className="flex space-x-2">
                      <input 
                        type="number" 
                        min="0"
                        value={splitSettings.threshold}
                        onChange={(e) => setSplitSettings(s => ({...s, threshold: parseInt(e.target.value) || 0}))}
                        className="flex-1 p-2.5 rounded-lg border border-[#e1e3e1] dark:border-[#333638] bg-white dark:bg-[#131314] focus:outline-none focus:ring-2 focus:ring-[#0b57d0]/20"
                      />
                      <select
                        value={splitSettings.thresholdMode}
                        onChange={(e) => setSplitSettings(s => ({...s, thresholdMode: e.target.value as 'chars' | 'lines'}))}
                        className="w-32 p-2.5 rounded-lg border border-[#e1e3e1] dark:border-[#333638] bg-white dark:bg-[#131314] focus:outline-none focus:ring-2 focus:ring-[#0b57d0]/20"
                      >
                        <option value="chars">Characters</option>
                        <option value="lines">Lines</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-1 text-[#444746] dark:text-[#c4c7c5]">Split by</label>
                    <select 
                      value={splitSettings.mode}
                      onChange={(e) => setSplitSettings(s => ({...s, mode: e.target.value as any}))}
                      className="w-full p-2.5 rounded-lg border border-[#e1e3e1] dark:border-[#333638] bg-white dark:bg-[#131314] focus:outline-none focus:ring-2 focus:ring-[#0b57d0]/20"
                    >
                      <option value="parts">Number of Parts</option>
                      <option value="chars">Characters</option>
                      <option value="lines">Lines</option>
                      <option value="regex">Regex Pattern</option>
                    </select>
                  </div>

                  {splitSettings.mode === 'regex' ? (
                    <div>
                      <label className="block text-sm font-medium mb-1 text-[#444746] dark:text-[#c4c7c5]">
                        Regex Pattern
                      </label>
                      <input 
                        type="text" 
                        value={splitSettings.regexPattern}
                        onChange={(e) => setSplitSettings(s => ({...s, regexPattern: e.target.value}))}
                        className="w-full p-2.5 rounded-lg border border-[#e1e3e1] dark:border-[#333638] bg-white dark:bg-[#131314] focus:outline-none focus:ring-2 focus:ring-[#0b57d0]/20 font-mono"
                        placeholder="e.g. ^## "
                      />
                    </div>
                  ) : (
                    <div>
                      <label className="block text-sm font-medium mb-1 text-[#444746] dark:text-[#c4c7c5]">
                        {splitSettings.mode === 'parts' ? 'Number of parts' : 
                         splitSettings.mode === 'chars' ? 'Characters per file' : 'Lines per file'}
                      </label>
                      <input 
                        type="number" 
                        min="1"
                        value={splitSettings.value}
                        onChange={(e) => setSplitSettings(s => ({...s, value: parseInt(e.target.value) || 0}))}
                        className="w-full p-2.5 rounded-lg border border-[#e1e3e1] dark:border-[#333638] bg-white dark:bg-[#131314] focus:outline-none focus:ring-2 focus:ring-[#0b57d0]/20"
                      />
                    </div>
                  )}

                  {splitSettings.mode !== 'regex' && (
                    <div>
                      <label className="block text-sm font-medium mb-1 text-[#444746] dark:text-[#c4c7c5]">
                        Overlap
                      </label>
                      <div className="flex space-x-2">
                        <input 
                          type="number" 
                          min="0"
                          value={splitSettings.overlap}
                          onChange={(e) => setSplitSettings(s => ({...s, overlap: parseInt(e.target.value) || 0}))}
                          className="flex-1 p-2.5 rounded-lg border border-[#e1e3e1] dark:border-[#333638] bg-white dark:bg-[#131314] focus:outline-none focus:ring-2 focus:ring-[#0b57d0]/20"
                        />
                        <select
                          value={splitSettings.overlapMode}
                          onChange={(e) => setSplitSettings(s => ({...s, overlapMode: e.target.value as 'chars' | 'lines'}))}
                          className="w-32 p-2.5 rounded-lg border border-[#e1e3e1] dark:border-[#333638] bg-white dark:bg-[#131314] focus:outline-none focus:ring-2 focus:ring-[#0b57d0]/20"
                        >
                          <option value="chars">Characters</option>
                          <option value="lines">Lines</option>
                        </select>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="mt-8 flex justify-end space-x-3">
              <button 
                onClick={async () => {
                  setShowSplitModal(false);
                  if (originalFiles.length > 0) {
                    setIsProcessing(true);
                    await buildTreeFromFiles(originalFiles, splitSettings);
                    setIsProcessing(false);
                  }
                }}
                className="px-6 py-2 bg-[#0b57d0] text-white dark:bg-[#a8c7fa] dark:text-[#041e49] rounded-full font-medium hover:bg-[#0842a0] dark:hover:bg-[#93b7f9] transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Chat Split Modal */}
      {showChatSplitModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-[#1e1f20] rounded-2xl p-6 w-full max-w-md shadow-xl border border-[#e1e3e1] dark:border-[#333638]">
            <h3 className="text-xl font-semibold mb-4">Smart Chat Splitting</h3>
            
            <div className="space-y-4">
              <label className="flex items-center space-x-2 cursor-pointer">
                <input 
                  type="checkbox" 
                  checked={chatSplitSettings.enabled}
                  onChange={(e) => setChatSplitSettings(s => ({...s, enabled: e.target.checked}))}
                  className="rounded border-[#c7c7c7] dark:border-[#444746] text-[#0b57d0] focus:ring-[#0b57d0] w-4 h-4"
                />
                <span className="font-medium">Enable smart splitting</span>
              </label>

              {chatSplitSettings.enabled && (
                <div className="space-y-4 pt-2 border-t border-[#e1e3e1] dark:border-[#333638]">
                  <div>
                    <label className="block text-sm font-medium mb-1 text-[#444746] dark:text-[#c4c7c5]">Split by</label>
                    <select 
                      value={chatSplitSettings.mode}
                      onChange={(e) => setChatSplitSettings(s => ({...s, mode: e.target.value as any}))}
                      className="w-full p-2.5 rounded-lg border border-[#e1e3e1] dark:border-[#333638] bg-white dark:bg-[#131314] focus:outline-none focus:ring-2 focus:ring-[#0b57d0]/20"
                    >
                      <option value="parts">Number of Parts</option>
                      <option value="chars">Estimated Characters</option>
                      <option value="lines">Estimated Lines</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-1 text-[#444746] dark:text-[#c4c7c5]">
                      {chatSplitSettings.mode === 'parts' ? 'Number of parts' : 
                       chatSplitSettings.mode === 'chars' ? 'Characters per file' : 'Lines per file'}
                    </label>
                    <input 
                      type="number" 
                      min="1"
                      value={chatSplitSettings.value}
                      onChange={(e) => setChatSplitSettings(s => ({...s, value: parseInt(e.target.value) || 0}))}
                      className="w-full p-2.5 rounded-lg border border-[#e1e3e1] dark:border-[#333638] bg-white dark:bg-[#131314] focus:outline-none focus:ring-2 focus:ring-[#0b57d0]/20"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-1 text-[#444746] dark:text-[#c4c7c5]">
                      Overlap (in messages)
                    </label>
                    <input 
                      type="number" 
                      min="0"
                      value={chatSplitSettings.overlap}
                      onChange={(e) => setChatSplitSettings(s => ({...s, overlap: parseInt(e.target.value) || 0}))}
                      className="w-full p-2.5 rounded-lg border border-[#e1e3e1] dark:border-[#333638] bg-white dark:bg-[#131314] focus:outline-none focus:ring-2 focus:ring-[#0b57d0]/20"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium mb-1 text-[#444746] dark:text-[#c4c7c5]">Must Start With</label>
                      <select 
                        value={chatSplitSettings.startWith}
                        onChange={(e) => setChatSplitSettings(s => ({...s, startWith: e.target.value as any}))}
                        className="w-full p-2.5 rounded-lg border border-[#e1e3e1] dark:border-[#333638] bg-white dark:bg-[#131314] focus:outline-none focus:ring-2 focus:ring-[#0b57d0]/20"
                      >
                        <option value="any">Any</option>
                        <option value="human">User</option>
                        <option value="agent">Agent</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1 text-[#444746] dark:text-[#c4c7c5]">Must End With</label>
                      <select 
                        value={chatSplitSettings.endWith}
                        onChange={(e) => setChatSplitSettings(s => ({...s, endWith: e.target.value as any}))}
                        className="w-full p-2.5 rounded-lg border border-[#e1e3e1] dark:border-[#333638] bg-white dark:bg-[#131314] focus:outline-none focus:ring-2 focus:ring-[#0b57d0]/20"
                      >
                        <option value="any">Any</option>
                        <option value="human">User</option>
                        <option value="agent">Agent</option>
                      </select>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="mt-8 flex justify-end space-x-3">
              <button 
                onClick={() => setShowChatSplitModal(false)}
                className="px-6 py-2 bg-[#0b57d0] text-white dark:bg-[#a8c7fa] dark:text-[#041e49] rounded-full font-medium hover:bg-[#0842a0] dark:hover:bg-[#93b7f9] transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Hidden Inputs */}
      <input type="file" ref={fileInputRef} onChange={handleFileInput} className="hidden" multiple />
      <input type="file" ref={folderInputRef} onChange={handleFileInput} className="hidden" 
        // @ts-ignore
        webkitdirectory="true" directory="true" multiple 
      />
    </div>
  );
}
