/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Users, 
  Plus, 
  ArrowLeft, 
  Search, 
  Filter, 
  Settings, 
  LogOut, 
  User as UserIcon,
  Wifi,
  WifiOff,
  CloudUpload,
  PieChart,
  IndianRupee,
  TrendingDown,
  TrendingUp,
  History,
  CheckCircle2,
  Calendar,
  ChevronRight,
  Eye,
  Pencil,
  Trash2
} from 'lucide-react';
import { db, addToSyncQueue } from './db';
import { useLiveQuery } from 'dexie-react-hooks';
import { cn, formatCurrency } from './lib/utils';
import { format } from 'date-fns';

const API_BASE_URL = import.meta.env.VITE_API_URL || '';
const apiUrl = path => `${API_BASE_URL}${path}`;

// --- Components ---

const toDateInputValue = value => {
  if (!value) return format(new Date(), 'yyyy-MM-dd');
  return format(new Date(value), 'yyyy-MM-dd');
};

const roundMoney = value => Math.round((Number(value) || 0) * 100) / 100;

function ExpenseDialog({ mode, expense, members = [], users = [], user, groupId, onClose, onSave, onDelete }) {
  const isView = mode === 'view';
  const isEdit = mode === 'edit';
  const title = isView ? 'Expense Details' : isEdit ? 'Modify Expense' : 'New Entry';
  const [description, setDescription] = useState(expense?.description || '');
  const [amount, setAmount] = useState(expense?.amount?.toString() || '');
  const [date, setDate] = useState(toDateInputValue(expense?.date));
  const [comments, setComments] = useState(expense?.comments || '');
  const [splitType, setSplitType] = useState(expense?.splitType || 'EQUAL');
  const [splitAmounts, setSplitAmounts] = useState(() => {
    const fromExpense = Object.fromEntries((expense?.splits || []).map(split => [split.userId, split.amount?.toString() || '']));
    return Object.fromEntries(members.map(member => [member.userId, fromExpense[member.userId] || '']));
  });
  const [selectedMembers, setSelectedMembers] = useState(() => {
    const splitUserIds = new Set((expense?.splits || []).map(split => split.userId));
    const defaultIds = members.map(member => member.userId);
    return new Set(splitUserIds.size > 0 ? splitUserIds : defaultIds);
  });

  const selectedUserIds = Array.from(selectedMembers);
  const numericAmount = roundMoney(amount);
  const unequalTotal = selectedUserIds.reduce((sum, userId) => sum + roundMoney(splitAmounts[userId]), 0);
  const equalShare = selectedUserIds.length > 0 ? roundMoney(numericAmount / selectedUserIds.length) : 0;
  const canSubmit = description.trim() && numericAmount > 0 && selectedUserIds.length > 0 && (splitType === 'EQUAL' || Math.abs(unequalTotal - numericAmount) < 0.01);

  const toggleMember = userId => {
    setSelectedMembers(current => {
      const next = new Set(current);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }
      return next;
    });
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;

    let runningSplitTotal = 0;
    const splits = selectedUserIds.map((userId, index) => {
      const amountForUser = splitType === 'EQUAL'
        ? (index === selectedUserIds.length - 1 ? roundMoney(numericAmount - runningSplitTotal) : equalShare)
        : roundMoney(splitAmounts[userId]);
      runningSplitTotal += amountForUser;
      return { userId, amount: amountForUser };
    });

    await onSave({
      id: expense?.id || crypto.randomUUID(),
      groupId,
      paidById: expense?.paidById || user.id,
      description: description.trim(),
      comments: comments.trim(),
      amount: numericAmount,
      date: new Date(`${date}T00:00:00`).toISOString(),
      splitType,
      splits,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-brand-bg/60 backdrop-blur-md overflow-y-auto">
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        className="bg-brand-surface rounded-[2rem] p-6 sm:p-8 w-full max-w-2xl shadow-2xl my-8 border border-white/10 relative overflow-hidden"
      >
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-indigo-500 to-cyan-500"></div>
        <div className="flex items-start justify-between gap-4 mb-8">
          <div>
            <h3 className="text-2xl font-black text-white tracking-tighter">{title}</h3>
            {expense && <p className="text-xs text-slate-500 font-bold mt-1">Paid by {users.find(u => u.id === expense.paidById)?.name || 'Unknown'}</p>}
          </div>
          {expense && !isView && (
            <button
              onClick={onDelete}
              className="p-2.5 text-rose-400 hover:bg-rose-500/10 rounded-xl transition-colors"
              title="Delete expense"
            >
              <Trash2 className="w-5 h-5" />
            </button>
          )}
        </div>

        <div className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1 block mb-2">Item Description</label>
              <input value={description} onChange={e => setDescription(e.target.value)} disabled={isView} type="text" placeholder="Dinner, train tickets, groceries..." className="w-full bg-[#252528] p-4 rounded-2xl border border-white/5 text-white placeholder-slate-600 focus:ring-2 focus:ring-indigo-500/50 focus:outline-none transition-all disabled:opacity-70" />
            </div>
            <div>
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1 block mb-2">Total Amount</label>
              <div className="relative">
                <IndianRupee className="w-5 h-5 absolute left-4 top-4 text-slate-600" />
                <input value={amount} onChange={e => setAmount(e.target.value)} disabled={isView} type="number" min="0" step="0.01" placeholder="0.00" className="w-full bg-[#252528] p-4 rounded-2xl border border-white/5 text-white placeholder-slate-600 pl-11 focus:ring-2 focus:ring-indigo-500/50 focus:outline-none transition-all font-bold text-lg disabled:opacity-70" />
              </div>
            </div>
            <div>
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1 block mb-2">Expense Date</label>
              <div className="relative">
                <Calendar className="w-5 h-5 absolute left-4 top-4 text-slate-600" />
                <input value={date} onChange={e => setDate(e.target.value)} disabled={isView} type="date" className="w-full bg-[#252528] p-4 rounded-2xl border border-white/5 text-white pl-11 focus:ring-2 focus:ring-indigo-500/50 focus:outline-none transition-all disabled:opacity-70" />
              </div>
            </div>
          </div>

          <div>
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1 block mb-2">Comments</label>
            <textarea value={comments} onChange={e => setComments(e.target.value)} disabled={isView} rows={3} placeholder="Add notes, receipt details, or context..." className="w-full bg-[#252528] p-4 rounded-2xl border border-white/5 text-white placeholder-slate-600 focus:ring-2 focus:ring-indigo-500/50 focus:outline-none transition-all resize-none disabled:opacity-70" />
          </div>

          <div>
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1 block mb-3">Split Type</label>
            <div className="grid grid-cols-2 gap-2 bg-[#252528] p-1 rounded-2xl border border-white/5">
              {['EQUAL', 'UNEQUAL'].map(type => (
                <button key={type} disabled={isView} onClick={() => setSplitType(type)} className={cn("py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all disabled:cursor-default", splitType === type ? "bg-indigo-600 text-white shadow-lg shadow-indigo-900/30" : "text-slate-500 hover:text-white")}>
                  {type === 'EQUAL' ? 'Equal' : 'By Amount'}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Distribute with</label>
              {splitType === 'UNEQUAL' && (
                <span className={cn("text-[10px] font-black uppercase tracking-widest", Math.abs(unequalTotal - numericAmount) < 0.01 ? "text-emerald-400" : "text-rose-400")}>
                  {formatCurrency(unequalTotal)} / {formatCurrency(numericAmount)}
                </span>
              )}
            </div>
            <div className="space-y-2 max-h-56 overflow-y-auto p-1 custom-scrollbar">
              {members.map(member => {
                const memberUser = users.find(item => item.id === member.userId);
                const checked = selectedMembers.has(member.userId);
                return (
                  <div key={member.id} className="grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_150px] items-center gap-3 p-3 rounded-2xl bg-[#252528] border border-white/5">
                    <label className="flex items-center gap-3 cursor-pointer min-w-0">
                      <input disabled={isView} type="checkbox" checked={checked} onChange={() => toggleMember(member.userId)} className="w-5 h-5 rounded-lg border-white/10 bg-brand-bg text-indigo-600 focus:ring-indigo-500/50 transition-all cursor-pointer disabled:cursor-default" />
                      <img src={memberUser?.avatar} className="w-8 h-8 rounded-full border border-white/10 shadow-sm" alt="" />
                      <span className="text-xs font-bold text-slate-200 truncate">{memberUser?.name || memberUser?.email}</span>
                    </label>
                    {splitType === 'UNEQUAL' ? (
                      <input disabled={isView || !checked} value={splitAmounts[member.userId] || ''} onChange={e => setSplitAmounts(current => ({ ...current, [member.userId]: e.target.value }))} type="number" min="0" step="0.01" placeholder="0.00" className="w-full bg-brand-bg p-2.5 rounded-xl border border-white/5 text-white text-sm font-bold focus:ring-2 focus:ring-indigo-500/50 focus:outline-none disabled:opacity-40" />
                    ) : (
                      <span className="text-right text-xs font-bold text-slate-500">{checked ? formatCurrency(equalShare) : '-'}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex gap-4 pt-6 border-t border-white/5">
            <button onClick={onClose} className="flex-1 py-3 text-slate-400 font-bold uppercase tracking-widest text-[10px] hover:text-white rounded-2xl transition-all">{isView ? 'Close' : 'Cancel'}</button>
            {isView ? (
              <button onClick={() => onSave(null, 'edit-request')} className="flex-1 py-3 bg-indigo-600 text-white rounded-2xl font-bold uppercase tracking-widest text-[10px] shadow-lg shadow-indigo-900/40 hover:bg-indigo-500 active:scale-95 transition-all">Edit</button>
            ) : (
              <button disabled={!canSubmit} onClick={handleSubmit} className="flex-1 py-3 bg-indigo-600 text-white rounded-2xl font-bold uppercase tracking-widest text-[10px] shadow-lg shadow-indigo-900/40 hover:bg-indigo-500 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed">
                {isEdit ? 'Save Changes' : 'Post Entry'}
              </button>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function PaymentDialog({ members = [], users = [], user, groupId, suggestedPayment, onClose, onSave }) {
  const defaultRecipientId = suggestedPayment?.toUserId || members.find(member => member.userId !== user.id)?.userId || '';
  const [toUserId, setToUserId] = useState(defaultRecipientId);
  const [amount, setAmount] = useState(suggestedPayment?.amount?.toString() || '');
  const [date, setDate] = useState(toDateInputValue(new Date()));
  const numericAmount = roundMoney(amount);
  const canSubmit = toUserId && numericAmount > 0;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    await onSave({
      id: crypto.randomUUID(),
      groupId,
      fromUserId: user.id,
      toUserId,
      amount: numericAmount,
      date: new Date(`${date}T00:00:00`).toISOString(),
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-brand-bg/60 backdrop-blur-md overflow-y-auto">
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        className="bg-brand-surface rounded-[2rem] p-6 sm:p-8 w-full max-w-md shadow-2xl my-8 border border-white/10 relative overflow-hidden"
      >
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-emerald-500 to-cyan-500"></div>
        <h3 className="text-2xl font-black text-white mb-8 tracking-tighter">Record Payment</h3>

        <div className="space-y-5">
          <div>
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1 block mb-2">Pay To</label>
            <select value={toUserId} onChange={e => setToUserId(e.target.value)} className="w-full bg-[#252528] p-4 rounded-2xl border border-white/5 text-white focus:ring-2 focus:ring-emerald-500/50 focus:outline-none transition-all">
              <option value="" disabled>Select member</option>
              {members.filter(member => member.userId !== user.id).map(member => {
                const memberUser = users.find(item => item.id === member.userId);
                return <option key={member.userId} value={member.userId}>{memberUser?.name || memberUser?.email || 'Member'}</option>;
              })}
            </select>
          </div>

          <div>
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1 block mb-2">Amount Paid</label>
            <div className="relative">
              <IndianRupee className="w-5 h-5 absolute left-4 top-4 text-slate-600" />
              <input value={amount} onChange={e => setAmount(e.target.value)} type="number" min="0" step="0.01" placeholder="0.00" className="w-full bg-[#252528] p-4 rounded-2xl border border-white/5 text-white placeholder-slate-600 pl-11 focus:ring-2 focus:ring-emerald-500/50 focus:outline-none transition-all font-bold text-lg" />
            </div>
          </div>

          <div>
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1 block mb-2">Payment Date</label>
            <div className="relative">
              <Calendar className="w-5 h-5 absolute left-4 top-4 text-slate-600" />
              <input value={date} onChange={e => setDate(e.target.value)} type="date" className="w-full bg-[#252528] p-4 rounded-2xl border border-white/5 text-white pl-11 focus:ring-2 focus:ring-emerald-500/50 focus:outline-none transition-all" />
            </div>
          </div>

          <div className="flex gap-4 pt-6 border-t border-white/5">
            <button onClick={onClose} className="flex-1 py-3 text-slate-400 font-bold uppercase tracking-widest text-[10px] hover:text-white rounded-2xl transition-all">Cancel</button>
            <button disabled={!canSubmit} onClick={handleSubmit} className="flex-1 py-3 bg-emerald-600 text-white rounded-2xl font-bold uppercase tracking-widest text-[10px] shadow-lg shadow-emerald-900/30 hover:bg-emerald-500 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed">Save Payment</button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function Navbar({ user, onLogout, isOnline, syncPending }) {
  return (
    <nav className="sticky top-0 z-50 bg-brand-bg/80 backdrop-blur-md border-b border-white/5">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16 items-center">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-indigo-600 rounded-lg shadow-lg shadow-indigo-900/20">
              <IndianRupee className="w-5 h-5 text-white" />
            </div>
            <a href="/">
            <span className="text-xl font-bold text-white tracking-tight hidden sm:block">SplitSync</span>
            </a>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider">
              {isOnline ? (
                <div className="flex items-center gap-1 text-emerald-400">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-400"></div>
                  <span className="hidden sm:inline">Synced</span>
                </div>
              ) : (
                <div className="flex items-center gap-1 text-orange-400">
                  <WifiOff className="w-4 h-4" />
                  <span className="hidden sm:inline">Offline Mode</span>
                </div>
              )}
              {syncPending > 0 && (
                <div className="flex items-center gap-1 text-indigo-400 animate-pulse">
                  <CloudUpload className="w-4 h-4" />
                  <span>{syncPending} pending</span>
                </div>
              )}
            </div>

            {user && (
              <div className="flex items-center gap-3 pl-4 border-l border-white/10">
                <div className="flex items-center gap-2">
                  <img src={user.avatar} alt={user.name} className="w-8 h-8 rounded-full border border-white/10" />
                  <span className="text-sm font-medium text-white hidden md:block">{user.name}</span>
                </div>
                <button 
                  onClick={onLogout}
                  className="p-2 text-slate-500 hover:text-rose-400 hover:bg-rose-400/10 rounded-lg transition-colors"
                  title="Logout"
                >
                  <LogOut className="w-5 h-5" />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}

function GoogleLogin({ onLogin }) {
  useEffect(() => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    document.body.appendChild(script);

    window.handleCredentialResponse = async (response) => {
      onLogin(response.credential);
    };

    script.onload = () => {};
  }, [onLogin]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-brand-bg px-4">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-md w-full bg-brand-surface p-8 rounded-3xl border border-white/5 text-center shadow-2xl relative overflow-hidden"
      >
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-indigo-500 to-purple-500"></div>
        <div className="p-4 bg-indigo-600 w-16 h-16 rounded-2xl mx-auto mb-6 flex items-center justify-center shadow-lg shadow-indigo-900/40">
          <IndianRupee className="w-10 h-10 text-white" />
        </div>
        <h1 className="text-3xl font-bold text-white mb-2 tracking-tight">SplitSync</h1>
        <p className="text-slate-500 mb-8 font-medium">Elegant expense sharing for modern teams & travelers.</p>
        
        <div className="flex justify-center flex-col items-center gap-4">
          <div 
            id="g_id_onload"
            data-client_id={import.meta.env.VITE_GOOGLE_CLIENT_ID}
            data-callback="handleCredentialResponse"
            data-auto_prompt="false"
          ></div>
          <div 
            className="g_id_signin"
            data-type="standard"
            data-size="large"
            data-theme="filled_black"
            data-text="sign_in_with"
            data-shape="rectangular"
            data-logo_alignment="left"
          ></div>
          
          <p className="text-[10px] text-slate-600 mt-6 uppercase tracking-widest font-bold">
            Secure Google Authentication
          </p>
        </div>
      </motion.div>
    </div>
  );
}

function GroupList({ groups, onCreateGroup, onSelectGroup, onAcceptInvite }) {
  const [isAdding, setIsAdding] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (newGroupName.trim()) {
      onCreateGroup(newGroupName);
      setNewGroupName('');
      setIsAdding(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h2 className="text-2xl font-bold text-white tracking-tight">Your Groups</h2>
          <p className="text-slate-500 font-medium">Manage shared expenses across your circles</p>
        </div>
        <button 
          onClick={() => setIsAdding(true)}
          className="flex items-center gap-2 bg-indigo-600 text-white px-5 py-2.5 rounded-xl hover:bg-indigo-500 transition-all shadow-lg shadow-indigo-900/40 text-sm font-semibold"
        >
          <Plus className="w-5 h-5" />
          <span>New Group</span>
        </button>
      </div>

      {groups?.filter(g => !g.joined).length > 0 && (
        <div className="mb-8 space-y-3">
          <h3 className="text-xs font-bold text-orange-400 uppercase tracking-widest px-1">Invitations</h3>
          {groups.filter(g => !g.joined).map(g => (
            <div key={g.id} className="bg-orange-500/10 border border-orange-500/20 p-4 rounded-2xl flex justify-between items-center shadow-sm backdrop-blur-sm">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-orange-500/20 flex items-center justify-center text-orange-400">
                  <Users className="w-5 h-5" />
                </div>
                <span className="font-semibold text-orange-200">Invite to {g.name}</span>
              </div>
              <button 
                onClick={async (e) => {
                  e.stopPropagation();
                  try {
                    await onAcceptInvite(g.id);
                  } catch (err) {
                    alert(err.message || 'Failed to accept invite');
                  }
                }}
                className="bg-orange-600 text-white px-5 py-2 rounded-xl text-xs font-bold hover:bg-orange-500 transition-colors shadow-lg shadow-orange-900/20"
              >
                Accept Join
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {groups?.filter(g => g.joined).map((group) => (
          <motion.div
            key={group.id}
            whileHover={{ scale: 1.02, y: -2 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => onSelectGroup(group.id)}
            className="bg-brand-surface p-6 rounded-3xl border border-white/5 cursor-pointer hover:border-white/10 transition-all flex justify-between items-center group shadow-xl"
          >
            <div className="flex items-center gap-4">
              <div className="p-3 bg-white/5 text-slate-400 rounded-2xl group-hover:bg-indigo-500 group-hover:text-white transition-all shadow-inner">
                <Users className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-bold text-white text-lg tracking-tight">{group.name}</h3>
                <p className="text-xs text-slate-500 font-medium">Created {format(new Date(group.createdAt), 'MMM d, yyyy')}</p>
              </div>
            </div>
            <ChevronRight className="w-5 h-5 text-slate-600 group-hover:text-indigo-400 group-hover:translate-x-1 transition-all" />
          </motion.div>
        ))}
        {(!groups || groups.length === 0) && (
          <div className="col-span-full py-16 text-center bg-brand-surface rounded-3xl border border-white/5 border-dashed">
            <Users className="w-16 h-16 mx-auto mb-4 text-slate-700" />
            <p className="text-slate-500 font-medium text-lg">No groups yet. Create one to start splitting!</p>
          </div>
        )}
      </div>

      <AnimatePresence>
        {isAdding && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-brand-bg/60 backdrop-blur-md">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-brand-surface rounded-3xl p-8 w-full max-w-md shadow-2xl border border-white/10 relative overflow-hidden"
            >
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-indigo-500 to-purple-500"></div>
              <h3 className="text-2xl font-bold text-white mb-6">Create New Group</h3>
              <form onSubmit={handleSubmit}>
                <input
                  autoFocus
                  type="text"
                  placeholder="Group Name (e.g. Ski Trip 2024)"
                  className="w-full bg-[#252528] p-4 rounded-2xl border border-white/5 text-white placeholder-slate-500 focus:ring-2 focus:ring-indigo-500/50 focus:outline-none mb-6 transition-all"
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                />
                <div className="flex gap-4">
                  <button
                    type="button"
                    onClick={() => setIsAdding(false)}
                    className="flex-1 px-4 py-3 text-slate-400 hover:text-white font-semibold rounded-2xl hover:bg-white/5 transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="flex-1 px-4 py-3 bg-indigo-600 text-white rounded-2xl hover:bg-indigo-500 transition-all shadow-lg shadow-indigo-900/40 font-bold"
                  >
                    Launch Group
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function GroupDetail({ groupId, onBack, user }) {
  const [activeTab, setActiveTab] = useState('summary');
  const [expenseDialog, setExpenseDialog] = useState(null);
  const [isSettleUp, setIsSettleUp] = useState(false);

  const group = useLiveQuery(() => db.groups.get(groupId), [groupId]);
  const expenses = useLiveQuery(() => db.expenses.where('groupId').equals(groupId).sortBy('date'), [groupId]);
  const payments = useLiveQuery(() => db.payments.where('groupId').equals(groupId).sortBy('date'), [groupId]);
  const members = useLiveQuery(() => db.members.where('groupId').equals(groupId).toArray(), [groupId]);
  const users = useLiveQuery(() => db.users.toArray());

  if (!group) return null;

  const sortedExpenses = [...(expenses || [])].sort((a, b) => new Date(b.date) - new Date(a.date));
  const sortedPayments = [...(payments || [])].sort((a, b) => new Date(b.date) - new Date(a.date));
  const balances = new Map((members || []).map(member => [member.userId, 0]));

  for (const expense of expenses || []) {
    balances.set(expense.paidById, roundMoney((balances.get(expense.paidById) || 0) + expense.amount));
    for (const split of expense.splits || []) {
      balances.set(split.userId, roundMoney((balances.get(split.userId) || 0) - split.amount));
    }
  }

  for (const payment of payments || []) {
    balances.set(payment.fromUserId, roundMoney((balances.get(payment.fromUserId) || 0) + payment.amount));
    balances.set(payment.toUserId, roundMoney((balances.get(payment.toUserId) || 0) - payment.amount));
  }

  const userBalance = roundMoney(balances.get(user.id) || 0);
  const youLent = Math.max(userBalance, 0);
  const youOwe = Math.max(-userBalance, 0);
  const suggestedRecipient = [...balances.entries()]
    .filter(([memberId, balance]) => memberId !== user.id && balance > 0)
    .sort((a, b) => b[1] - a[1])[0];
  const suggestedPayment = suggestedRecipient
    ? { toUserId: suggestedRecipient[0], amount: roundMoney(Math.min(youOwe, suggestedRecipient[1])) }
    : null;

  const saveExpense = async (expense, action) => {
    if (action === 'edit-request') {
      setExpenseDialog({ mode: 'edit', expense: expenseDialog.expense });
      return;
    }

    if (expenseDialog?.mode === 'edit') {
      await db.expenses.put(expense);
      await addToSyncQueue('UPDATE', 'expenses', expense);
    } else {
      await db.expenses.add(expense);
      await addToSyncQueue('CREATE', 'expenses', expense);
    }
    setExpenseDialog(null);
  };

  const deleteExpense = async (targetExpense = expenseDialog?.expense) => {
    if (!targetExpense) return;
    const confirmed = window.confirm('Delete this expense? This removes it for everyone in the group.');
    if (!confirmed) return;
    await db.expenses.delete(targetExpense.id);
    await addToSyncQueue('DELETE', 'expenses', { id: targetExpense.id });
    setExpenseDialog(null);
  };

  const savePayment = async (payment) => {
    await db.payments.add(payment);
    await addToSyncQueue('CREATE', 'payments', payment);
    setIsSettleUp(false);
  };

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-8">
      <div className="flex items-center gap-4 mb-8 group">
        <button 
          onClick={onBack}
          className="p-2.5 bg-brand-surface rounded-xl border border-white/5 text-slate-400 hover:text-white hover:border-white/10 transition-all shadow-lg"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight leading-tight">{group.name}</h1>
          <p className="text-slate-500 font-medium flex items-center gap-2">
            <Users className="w-4 h-4" />
            {members?.length || 0} Members • Managed by you
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        {/* Stats Column */}
        <div className="lg:col-span-3 space-y-8">
          <section className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            <div className="bg-brand-surface p-7 rounded-3xl border border-white/5 shadow-xl relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                <PieChart className="w-16 h-16 text-white" />
              </div>
              <span className="text-[10px] text-slate-500 uppercase font-bold tracking-widest block mb-2">Group Total</span>
              <div className="text-3xl font-bold text-white tracking-tighter">
                {formatCurrency(expenses?.reduce((sum, e) => sum + e.amount, 0) || 0)}
              </div>
            </div>
            
            <div className="bg-brand-surface p-7 rounded-3xl border-l-4 border-emerald-500/50 border-white/5 shadow-xl group">
              <span className="text-[10px] text-emerald-500 uppercase font-bold tracking-widest block mb-2">You Lent</span>
              <div className="text-3xl font-bold text-emerald-400 tracking-tighter">
                {formatCurrency(youLent)}
              </div>
              <p className="text-[10px] text-slate-500 mt-2 font-bold uppercase tracking-tight">Recoverable Balance</p>
            </div>

            <div className="bg-brand-surface p-7 rounded-3xl border-l-4 border-rose-500/50 border-white/5 shadow-xl group">
              <span className="text-[10px] text-rose-500 uppercase font-bold tracking-widest block mb-2">You Owe</span>
              <div className="text-3xl font-bold text-rose-400 tracking-tighter">
                {formatCurrency(youOwe)}
              </div>
              <button onClick={() => setIsSettleUp(true)} className="mt-3 text-[10px] font-black text-indigo-400 hover:text-indigo-300 uppercase tracking-widest">Settle Up Now</button>
            </div>
          </section>

          {/* Tabs Container */}
          <div className="bg-brand-surface/40 rounded-[2rem] border border-white/5 overflow-hidden flex flex-col min-h-[500px] shadow-2xl backdrop-blur-sm">
            <div className="flex p-2 bg-brand-surface border-b border-white/5 gap-1 overflow-x-auto no-scrollbar">
              {['summary', 'expenses', 'history', 'members'].map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={cn(
                    "px-6 py-2.5 rounded-2xl text-xs font-bold uppercase tracking-widest transition-all",
                    activeTab === tab ? "bg-indigo-600 text-white shadow-lg shadow-indigo-900/20" : "text-slate-500 hover:text-slate-200 hover:bg-white/5"
                  )}
                >
                  {tab}
                </button>
              ))}
            </div>

            <div className="flex-1 p-6 overflow-y-auto">
              <AnimatePresence mode="wait">
                <motion.div
                  key={activeTab}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2 }}
                >
                  {activeTab === 'summary' && (
                    <div className="space-y-6">
                       <div className="flex items-center justify-between">
                         <h3 className="font-bold text-white text-lg">Activity Stream</h3>
                         <Filter className="w-4 h-4 text-slate-500" />
                       </div>
                       <div className="space-y-4">
                         {sortedExpenses.slice(0, 8).map(exp => (
                           <button key={exp.id} onClick={() => setExpenseDialog({ mode: 'view', expense: exp })} className="w-full text-left flex items-center p-4 bg-brand-surface rounded-2xl border border-white/5 hover:bg-white/[0.02] transition-all group">
                             <div className="w-10 h-10 rounded-full bg-indigo-500/10 flex items-center justify-center text-indigo-400 mr-4 group-hover:scale-110 transition-transform shadow-inner">
                               <PieChart className="w-5 h-5" />
                             </div>
                             <div className="flex-1">
                               <div className="text-sm font-bold text-white">{exp.description}</div>
                               <div className="text-[10px] text-slate-500 font-bold uppercase tracking-tight">Paid by {users?.find(u => u.id === exp.paidById)?.name || 'You'}{exp.comments ? ' • With comments' : ''}</div>
                             </div>
                             <div className="text-right">
                               <div className="text-sm font-bold text-white tracking-tight">{formatCurrency(exp.amount)}</div>
                               <div className="text-[10px] text-slate-500">{format(new Date(exp.date), 'MMM d')}</div>
                             </div>
                           </button>
                         ))}
                         {(!expenses || expenses.length === 0) && (
                           <div className="py-20 text-center opacity-20 flex flex-col items-center">
                              <History className="w-16 h-16 mb-4" />
                              <p className="font-bold uppercase tracking-widest text-xs">No transactions visible</p>
                           </div>
                         )}
                       </div>
                    </div>
                  )}

                  {activeTab === 'expenses' && (
                    <div className="space-y-4">
                       <div className="relative mb-6">
                         <Search className="w-4 h-4 absolute left-4 top-3.5 text-slate-500" />
                         <input type="text" placeholder="Search entries..." className="w-full bg-brand-bg border border-white/5 rounded-2xl py-3 pl-11 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 text-slate-200 placeholder-slate-600" />
                       </div>
                       {sortedExpenses.map(exp => (
                          <div key={exp.id} className="bg-brand-surface p-5 rounded-2xl border border-white/5 hover:border-white/10 transition-all">
                            <div className="flex justify-between items-start gap-4 mb-2">
                              <div className="min-w-0">
                                <h4 className="font-bold text-white tracking-tight">{exp.description}</h4>
                                {exp.comments && <p className="text-xs text-slate-500 mt-1 line-clamp-2">{exp.comments}</p>}
                              </div>
                              <span className="text-lg font-bold text-indigo-400 tracking-tighter shrink-0">{formatCurrency(exp.amount)}</span>
                            </div>
                            <div className="flex flex-col sm:flex-row sm:justify-between gap-3 text-[11px] font-bold text-slate-500 uppercase tracking-widest">
                              <span>{format(new Date(exp.date), 'MMMM d, yyyy')}</span>
                              <div className="flex items-center gap-2">
                                <span className="text-slate-400">Paid by {users?.find(u => u.id === exp.paidById)?.name || 'Unknown'}</span>
                                <button onClick={() => setExpenseDialog({ mode: 'view', expense: exp })} className="p-2 text-slate-500 hover:text-cyan-400 hover:bg-cyan-400/10 rounded-lg transition-colors" title="View expense">
                                  <Eye className="w-4 h-4" />
                                </button>
                                <button onClick={() => setExpenseDialog({ mode: 'edit', expense: exp })} className="p-2 text-slate-500 hover:text-indigo-400 hover:bg-indigo-400/10 rounded-lg transition-colors" title="Modify expense">
                                  <Pencil className="w-4 h-4" />
                                </button>
                                <button onClick={() => deleteExpense(exp)} className="p-2 text-slate-500 hover:text-rose-400 hover:bg-rose-400/10 rounded-lg transition-colors" title="Delete expense">
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </div>
                          </div>
                       ))}
                    </div>
                  )}

                  {activeTab === 'members' && (
                    <div className="space-y-8">
                       <div className="bg-brand-bg/50 p-6 rounded-3xl border border-white/5 border-dashed">
                         <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4">Invite New Contributor</h3>
                         <div className="flex gap-3">
                           <input 
                             type="email" 
                             placeholder="friend@email.com" 
                             id="invite-email"
                             className="flex-1 bg-brand-surface p-4 rounded-2xl border border-white/5 text-white placeholder-slate-600 focus:ring-2 focus:ring-indigo-500/50 focus:outline-none transition-all"
                           />
                           <button 
                             onClick={async () => {
                               const email = document.getElementById('invite-email').value;
                               if (email) {
                                 const res = await fetch(apiUrl(`/api/groups/${groupId}/invite`), {
                                   method: 'POST',
                                   headers: { 'Content-Type': 'application/json' },
                                   credentials: 'include',
                                   body: JSON.stringify({ email })
                                 });
                                 if (res.ok) { document.getElementById('invite-email').value = ''; }
                               }
                             }}
                             className="bg-indigo-600 text-white px-6 py-2 rounded-2xl hover:bg-indigo-500 font-bold shadow-lg shadow-indigo-900/20"
                           >
                             Invite
                           </button>
                         </div>
                       </div>

                       <div className="space-y-4">
                         <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest px-2">Active Members</h3>
                         {members?.map(member => {
                           const u = users?.find(u => u.id === member.userId);
                           return (
                             <div key={member.id} className="bg-brand-surface p-4 rounded-2xl border border-white/5 flex justify-between items-center group hover:bg-white/[0.02] transition-all">
                               <div className="flex items-center gap-4">
                                 <div className="relative">
                                   <img src={u?.avatar} className="w-10 h-10 rounded-full border border-white/10" alt="" />
                                   <div className={cn("absolute bottom-0 right-0 w-3 h-3 border-2 border-brand-surface rounded-full", member.joined ? "bg-emerald-500" : "bg-orange-500")}></div>
                                 </div>
                                 <div>
                                   <p className="font-bold text-white tracking-tight">{u?.name || u?.email}</p>
                                   <p className="text-[10px] text-slate-500 font-black uppercase tracking-widest">{member.role}</p>
                                 </div>
                               </div>
                               {!member.joined ? (
                                 <span className="text-[10px] bg-orange-500/10 text-orange-400 px-3 py-1 rounded-full font-black uppercase tracking-widest border border-orange-500/20">Pending</span>
                               ) : (
                                 <CheckCircle2 className="w-5 h-5 text-emerald-500 opacity-50" />
                               )}
                             </div>
                           );
                         })}
                       </div>
                    </div>
                  )}

                  {activeTab === 'history' && (
                    <div className="space-y-4">
                       {[...sortedExpenses, ...sortedPayments]
                        .sort((a,b) => new Date(b.date) - new Date(a.date))
                        .map(item => {
                          const fromUser = users?.find(u => u.id === item.fromUserId);
                          const toUser = users?.find(u => u.id === item.toUserId);
                          return (
                          <div key={item.id} className={cn("bg-brand-surface p-4 rounded-2xl border border-white/5 flex justify-between items-center border-l-2", item.paidById ? "border-l-indigo-500/50" : "border-l-emerald-500/50")}>
                             <div className="flex gap-4">
                                <div className={cn("p-2.5 rounded-xl shadow-inner", item.paidById ? "bg-indigo-500/10 text-indigo-400" : "bg-emerald-500/10 text-emerald-400")}>
                                  {item.paidById ? <PieChart className="w-5 h-5" /> : <CheckCircle2 className="w-5 h-5" />}
                                </div>
                                <div>
                                  <p className="font-bold text-white tracking-tight">{item.description || "Settlement Record"}</p>
                                  {!item.paidById && <p className="text-xs text-slate-500 mt-0.5">{fromUser?.name || 'Someone'} paid {toUser?.name || 'someone'}</p>}
                                  <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">{format(new Date(item.date), 'MMM d, h:mm a')}</p>
                                </div>
                             </div>
                             <div className="text-right">
                               <p className={cn("text-sm font-black tracking-tight", item.paidById ? "text-white" : "text-emerald-400")}>
                                 {item.paidById ? '-' : '+'}{formatCurrency(item.amount)}
                               </p>
                             </div>
                          </div>
                          );
                        })
                       }
                    </div>
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </div>

        {/* Action Column */}
        <div className="lg:col-span-1 space-y-6">
           <button 
             onClick={() => setExpenseDialog({ mode: 'create' })}
             className="w-full py-4 bg-indigo-600 text-white rounded-3xl font-bold flex items-center justify-center gap-2 hover:bg-indigo-500 shadow-2xl shadow-indigo-900/40 transition-all border border-indigo-400/20 active:scale-95"
           >
             <Plus className="w-6 h-6" />
             <span>Add Expense</span>
           </button>
           
           <div className="bg-brand-surface p-6 rounded-[2rem] border border-white/5 shadow-xl">
             <h4 className="text-xs font-black text-slate-500 uppercase tracking-widest mb-6">Group Health</h4>
             <div className="space-y-4">
               <div className="flex justify-between items-end">
                 <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tight">Sync Status</span>
                 <span className="text-[10px] font-bold text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded-full uppercase">Optimal</span>
               </div>
               <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                   <div className="h-full bg-indigo-500 w-[95%]"></div>
               </div>
               <p className="text-[11px] text-slate-500 leading-relaxed font-medium">All local transactions are persistent and ready for cloud sync.</p>
             </div>
           </div>

           <div className="bg-brand-surface p-6 rounded-[2rem] border border-white/5 shadow-xl">
              <h4 className="text-xs font-black text-slate-500 uppercase tracking-widest mb-4">Integrity</h4>
              <div className="flex items-center gap-3 text-slate-400">
                 <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"></div>
                 <span className="text-[10px] font-bold uppercase tracking-widest">Database Local</span>
              </div>
           </div>
        </div>
      </div>

      <AnimatePresence>
        {expenseDialog && (
          <ExpenseDialog
            mode={expenseDialog.mode}
            expense={expenseDialog.expense}
            members={members || []}
            users={users || []}
            user={user}
            groupId={groupId}
            onClose={() => setExpenseDialog(null)}
            onSave={saveExpense}
            onDelete={deleteExpense}
          />
        )}
        {isSettleUp && (
          <PaymentDialog
            members={members || []}
            users={users || []}
            user={user}
            groupId={groupId}
            suggestedPayment={suggestedPayment}
            onClose={() => setIsSettleUp(false)}
            onSave={savePayment}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showSyncFallback, setShowSyncFallback] = useState(false);
  const [currentGroupId, setCurrentGroupId] = useState(null);
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    let fallbackTimer;
    if (loading) {
      fallbackTimer = setTimeout(() => setShowSyncFallback(true), 6000);
    }
    return () => clearTimeout(fallbackTimer);
  }, [loading]);

  // Live queries
  const groups = useLiveQuery(() => db.groups.toArray());
  const syncPending = useLiveQuery(() => db.syncQueue.count()) || 0;

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // const checkAuth = async () => {
    //   try {
    //     const res = await fetch(apiUrl('/api/me'), { credentials: 'include' });
    //     if (res.ok) {
    //       const data = await res.json();
    //       setUser(data);
    //       // Trigger sync in background
    //       syncData();
    //     } else {
    //       setUser(null);
    //     }
    //   } catch (err) {
    //     console.error('Auth check failed:', err);
    //     setUser(null);
    //   } finally {
    //     setLoading(false);
    //   }
    // };
    const checkAuth = async () => {
  try {
    // OFFLINE PATH
    if (!navigator.onLine) {
      const cachedUser = await db.users.toCollection().first();

      if (cachedUser) {
        console.log('Offline mode');
        setUser(cachedUser);
      } else {
        setUser(null);
      }

      return;
    }

    // ONLINE PATH
    const res = await fetch(apiUrl('/api/me'), {
      credentials: 'include'
    });

    if (!res.ok) {
      setUser(null);
      return;
    }

    const userData = await res.json();

    setUser(userData);

    await db.users.put(userData);

    syncData();

  } catch (err) {
    console.error(err);

    const cachedUser = await db.users.toCollection().first();

    if (cachedUser) {
      setUser(cachedUser);
    } else {
      setUser(null);
    }
  } finally {
    setLoading(false);
  }
};
    checkAuth();

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Sync logic
  useEffect(() => {
    if (isOnline && syncPending > 0) {
      processSyncQueue();
    }
  }, [isOnline, syncPending]);

  const syncData = async () => {
    try {
      const res = await fetch(apiUrl('/api/sync'), { credentials: 'include' });
      const data = await res.json();
      if (data.groups) {
        // Update Lexie
        await db.transaction('rw', [db.groups, db.expenses, db.payments, db.members, db.users], async () => {
          await db.groups.clear();
          await db.groups.bulkAdd(data.groups.map(({ members, expenses, payments, ...g }) => g));
          
          await db.members.clear();
          await db.users.clear();
          for (const g of data.groups) {
            if (g.members) {
              await db.members.bulkAdd(g.members.map(m => ({
                id: m.id, groupId: g.id, userId: m.userId, role: m.role, joined: m.joined
              })));
              await db.users.bulkPut(g.members.map(m => m.user).filter(Boolean));
            }
          }

          await db.expenses.clear();
          for (const g of data.groups) {
             if (g.expenses) await db.expenses.bulkAdd(g.expenses);
          }

          await db.payments.clear();
          for (const g of data.groups) {
             if (g.payments) await db.payments.bulkAdd(g.payments);
          }
        });
      }
    } catch (e) {
      console.error('Sync failed', e);
    }
  };

  const processSyncQueue = async () => {
    const items = await db.syncQueue.toArray();
    for (const item of items) {
      try {
        const endpoint = item.table === 'groups' ? '/api/groups' : (item.table === 'expenses' ? '/api/expenses' : '/api/payments');
        const method = item.action === 'UPDATE' ? 'PUT' : item.action === 'DELETE' ? 'DELETE' : 'POST';
        const requestUrl = item.action === 'UPDATE' || item.action === 'DELETE'
          ? `${endpoint}/${item.data.id}`
          : endpoint;
        const res = await fetch(apiUrl(requestUrl), {
          method,
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: item.action === 'DELETE' ? undefined : JSON.stringify(item.data),
        });
        if (res.ok) {
          await db.syncQueue.delete(item.id);
        }
      } catch (e) {
        break; // Stop if still offline or error
      }
    }
  };

  const handleLogin = async (token) => {
    const res = await fetch(apiUrl('/api/auth/google'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ token }),
    });
    const data = await res.json();
    if (!data.error) {
      setUser(data);
      syncData();
    }
  };

  const handleLogout = async () => {
    await fetch(apiUrl('/api/auth/logout'), { method: 'POST', credentials: 'include' });
    setUser(null);
    await db.delete(); // Clear local cache on logout
    window.location.reload();
  };

  const handleCreateGroup = async (name) => {
    const newGroup = {
      id: crypto.randomUUID(),
      name,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    await db.groups.add(newGroup);
    await addToSyncQueue('CREATE', 'groups', { name }); // Server creates actual membership
    if (isOnline) syncData();
  };

  const handleAcceptInvite = async (groupId) => {
    const res = await fetch(apiUrl(`/api/groups/${groupId}/join`), {
      method: 'POST',
      credentials: 'include',
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to accept invite');
    }

    await syncData();
  };

  if (loading) return (
    <div className="min-h-screen bg-brand-bg flex flex-col items-center justify-center text-slate-500 font-medium">
      <div className="mb-4 text-indigo-500 animate-pulse font-bold tracking-widest uppercase text-xs">Synchronizing</div>
      <p>SplitSync is loading...</p>
      {showSyncFallback && (
        <button 
          onClick={() => window.location.reload()}
          className="mt-8 text-[10px] uppercase tracking-widest font-bold text-slate-600 hover:text-indigo-400 transition-colors"
        >
          Taking too long? Try forcing a refresh
        </button>
      )}
    </div>
  );

  if (!user) return <GoogleLogin onLogin={handleLogin} />;

  return (
    <div className="min-h-screen bg-brand-bg font-sans selection:bg-indigo-500/30 selection:text-white">
      <Navbar 
        user={user} 
        onLogout={handleLogout} 
        isOnline={isOnline} 
        syncPending={syncPending} 
      />
      
      <main className="container mx-auto">
        <AnimatePresence mode="wait">
          {currentGroupId ? (
            <motion.div
              key="detail"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
            >
              <GroupDetail 
                groupId={currentGroupId} 
                onBack={() => setCurrentGroupId(null)} 
                user={user}
              />
            </motion.div>
          ) : (
            <motion.div
              key="list"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
            >
              <GroupList 
                groups={groups} 
                onCreateGroup={handleCreateGroup}
                onSelectGroup={setCurrentGroupId}
                onAcceptInvite={handleAcceptInvite}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Bottom Floating Info for Offline */}
      {!isOnline && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100]">
          <motion.div 
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="px-6 py-2.5 bg-orange-600 text-white rounded-full text-xs font-bold shadow-2xl flex items-center gap-3 border border-orange-500/50 backdrop-blur-md"
          >
            <div className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-white"></span>
            </div>
            <span>Offline Mode • Changes will sync automatically</span>
          </motion.div>
        </div>
      )}
    </div>
  );
}
