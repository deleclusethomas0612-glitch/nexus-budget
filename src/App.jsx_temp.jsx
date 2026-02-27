import React, { useState, useMemo, useEffect } from 'react';
import { BarChart, Bar, XAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import {
    TrendingUp, Users, Wallet, AlertCircle, Plus, Check, X, Trash2, Pencil,
    Banknote, ShieldCheck, History as HistoryIcon, Zap, HeartPulse,
    Receipt, ArrowDownLeft, ArrowUpRight, Home, Calendar, Coins, LogOut, Loader2, Flame,
    PiggyBank, CheckSquare, MessageSquare, Save, Archive, GripVertical
} from 'lucide-react';
import { supabase } from './supabase';
import { motion, Reorder, useDragControls } from 'framer-motion';

// --- COMPOSANT DE RÉORGANISATION AVEC LONG PRESS ---
const DraggableItem = ({ children, value }) => {
    const dragControls = useDragControls();
    const [isPressing, setIsPressing] = useState(false);
    let timer;

    const handlePointerDown = (e) => {
        setIsPressing(true);
        timer = setTimeout(() => {
            dragControls.start(e);
        }, 600); // 600ms pour éviter les erreurs au scroll
    };

    const clearTimer = () => {
        setIsPressing(false);
        if (timer) clearTimeout(timer);
    };

    return (
        <Reorder.Item
            value={value}
            dragControls={dragControls}
            dragListener={false}
            onPointerDown={handlePointerDown}
            onPointerUp={clearTimer}
            onPointerLeave={clearTimer}
            whileDrag={{ scale: 1.05, zIndex: 50, rotate: 1 }}
            className={`relative transition-transform ${isPressing ? 'scale-[0.98]' : ''}`}
        >
            {children}
        </Reorder.Item>
    );
};
