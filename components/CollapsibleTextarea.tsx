import React, { useState } from 'react';
import { ChevronDown, ChevronUp, ArrowRight } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface CollapsibleTextareaProps {
  value: string;
  onChange: (val: string) => void;
  placeholder: string;
  onNext: () => void;
  nextLabel?: string;
}

export function CollapsibleTextarea({ value, onChange, placeholder, onNext, nextLabel = "Next Step" }: CollapsibleTextareaProps) {
  const [expanded, setExpanded] = useState(false);
  const hasContent = value.length > 0;
  const isLong = value.split('\n').length > 8 || value.length > 400;

  return (
    <motion.div 
      layout
      className="relative w-full border border-[#e1e3e1] dark:border-[#333638] rounded-3xl bg-white dark:bg-[#1e1f20] overflow-hidden shadow-sm focus-within:ring-2 focus-within:ring-[#0b57d0]/20 focus-within:border-[#0b57d0] flex flex-col"
      animate={{ height: expanded ? '65vh' : hasContent ? (isLong ? '320px' : 'auto') : '240px' }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
    >
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full h-full p-8 bg-transparent resize-none focus:outline-none font-mono text-sm custom-scrollbar"
        style={{ paddingBottom: expanded ? '100px' : '24px' }}
      />
      
      <AnimatePresence>
        {hasContent && !expanded && isLong && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute bottom-0 left-0 right-0 h-40 bg-gradient-to-t from-white dark:from-[#1e1f20] via-white/90 dark:via-[#1e1f20]/90 to-transparent flex items-end justify-center pb-8 space-x-4 pointer-events-none"
          >
            <button 
              onClick={() => setExpanded(true)}
              className="pointer-events-auto flex items-center px-6 py-3 bg-white dark:bg-[#333638] border border-[#e1e3e1] dark:border-[#444746] rounded-full shadow-md text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-[#444746] dark:text-[#c4c7c5]"
            >
              <ChevronDown size={18} className="mr-2" />
              Expand to View All
            </button>
            <button 
              onClick={onNext}
              className="pointer-events-auto flex items-center px-8 py-3 bg-[#0b57d0] text-white dark:bg-[#a8c7fa] dark:text-[#041e49] rounded-full shadow-md text-sm font-medium hover:bg-[#0842a0] dark:hover:bg-[#93b7f9] transition-colors"
            >
              {nextLabel}
              <ArrowRight size={18} className="ml-2" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {hasContent && expanded && (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="absolute top-6 right-6 flex flex-col space-y-3 pointer-events-auto z-10"
          >
            <button 
              onClick={onNext}
              className="flex items-center justify-center px-6 py-3.5 bg-[#0b57d0] text-white dark:bg-[#a8c7fa] dark:text-[#041e49] rounded-full shadow-lg font-medium hover:bg-[#0842a0] dark:hover:bg-[#93b7f9] transition-colors text-sm"
            >
              {nextLabel}
              <ArrowRight size={18} className="ml-2" />
            </button>
            <button 
              onClick={() => setExpanded(false)}
              className="flex items-center justify-center px-6 py-2.5 bg-white dark:bg-[#333638] border border-[#e1e3e1] dark:border-[#444746] rounded-full shadow-lg text-[#444746] dark:text-[#c4c7c5] hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-sm font-medium"
            >
              <ChevronUp size={18} className="mr-2" />
              Collapse
            </button>
          </motion.div>
        )}
      </AnimatePresence>
      
      <AnimatePresence>
        {hasContent && !expanded && !isLong && (
           <motion.div 
             initial={{ opacity: 0 }}
             animate={{ opacity: 1 }}
             exit={{ opacity: 0 }}
             className="absolute bottom-8 right-8 pointer-events-auto"
           >
            <button 
              onClick={onNext}
              className="flex items-center px-8 py-3 bg-[#0b57d0] text-white dark:bg-[#a8c7fa] dark:text-[#041e49] rounded-full shadow-lg font-medium hover:bg-[#0842a0] dark:hover:bg-[#93b7f9] transition-colors"
            >
              {nextLabel}
              <ArrowRight size={18} className="ml-2" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
