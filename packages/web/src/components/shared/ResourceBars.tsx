/**
 * Shared resource bar components for RAM and disk display.
 * Used by ModelsPanel (full size) and ModelPicker (compact).
 * Matches the desktop app's segmented bar design.
 */

import { MemoryStick, HardDrive } from "lucide-react";
import { adminLabel } from "@/lib/models";
import type { InstalledModel, SystemResources, StorageBreakdown } from "@edgebric/types";

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const gb = bytes / (1024 ** 3);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / (1024 ** 2);
  return `${mb.toFixed(0)} MB`;
}

// ─── Segmented RAM Bar (full size) ──────────────────────────────────────────

export function RAMBar({ models, embeddingModel, system }: {
  models: InstalledModel[];
  embeddingModel?: InstalledModel;
  system: SystemResources;
}) {
  const ramTotal = system.ramTotalBytes;
  const ramUsed = ramTotal - system.ramAvailableBytes;
  const modelRam = models
    .filter((m) => m.ramUsageBytes)
    .reduce((sum, m) => sum + (m.ramUsageBytes ?? 0), 0);
  const embeddingRam = embeddingModel?.ramUsageBytes ?? 0;
  const serverRam = system.serverRamBytes ?? 0;
  const otherUsed = Math.max(0, ramUsed - modelRam - embeddingRam - serverRam);
  const pctOf = (bytes: number) => ramTotal > 0 ? Math.max(0, (bytes / ramTotal) * 100) : 0;

  return (
    <div className="flex items-center gap-3">
      <MemoryStick className="w-4 h-4 text-slate-400 dark:text-gray-500 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between text-xs mb-1">
          <span className="text-slate-600 dark:text-gray-400">Memory</span>
          <span className="text-slate-500 dark:text-gray-500 font-mono">
            {formatBytes(system.ramAvailableBytes)} available / {formatBytes(ramTotal)} total
          </span>
        </div>
        <div className="h-1.5 rounded-full bg-slate-100 dark:bg-gray-800 overflow-hidden flex">
          <div className="h-full bg-slate-400 dark:bg-gray-600 transition-all" style={{ width: `${pctOf(otherUsed)}%` }} />
          {serverRam > 0 && (
            <div className="h-full bg-violet-500 dark:bg-violet-400 transition-all" style={{ width: `${pctOf(serverRam)}%` }} />
          )}
          {embeddingRam > 0 && (
            <div className="h-full bg-cyan-500 dark:bg-cyan-400 transition-all" style={{ width: `${pctOf(embeddingRam)}%` }} />
          )}
          {modelRam > 0 && (
            <div className="h-full bg-blue-500 dark:bg-blue-400 transition-all" style={{ width: `${pctOf(modelRam)}%` }} />
          )}
        </div>
        <div className="flex items-center gap-3 mt-1.5 flex-wrap">
          {models.filter((m) => m.ramUsageBytes).map((m) => (
            <span key={m.tag} className="flex items-center gap-1 text-[10px] text-slate-500 dark:text-gray-400">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-500 dark:bg-blue-400" />
              {adminLabel(m.tag)} {formatBytes(m.ramUsageBytes!)}
            </span>
          ))}
          {embeddingRam > 0 && (
            <span className="flex items-center gap-1 text-[10px] text-slate-500 dark:text-gray-400">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-500 dark:bg-cyan-400" />
              Embeddings {formatBytes(embeddingRam)}
            </span>
          )}
          {serverRam > 0 && (
            <span className="flex items-center gap-1 text-[10px] text-slate-500 dark:text-gray-400">
              <span className="w-1.5 h-1.5 rounded-full bg-violet-500 dark:bg-violet-400" />
              Server {formatBytes(serverRam)}
            </span>
          )}
          <span className="flex items-center gap-1 text-[10px] text-slate-500 dark:text-gray-400">
            <span className="w-1.5 h-1.5 rounded-full bg-slate-400 dark:bg-gray-600" />
            Other {formatBytes(otherUsed)}
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Disk Bar (full size) ───────────────────────────────────────────────────

export function DiskBar({ system, storage }: { system: SystemResources; storage?: StorageBreakdown }) {
  const diskTotal = system.diskTotalBytes;
  const diskUsed = diskTotal - system.diskFreeBytes;
  const pctOf = (bytes: number) => diskTotal > 0 ? Math.max(0, (bytes / diskTotal) * 100) : 0;

  const modelsSize = storage?.modelsBytes ?? 0;
  const uploadsBytes = storage?.uploadsBytes ?? 0;
  const dbBytes = storage?.dbBytes ?? 0;
  const vaultBytes = storage?.vaultBytes ?? 0;
  const edgebricTotal = modelsSize + uploadsBytes + dbBytes + vaultBytes;
  const otherUsed = Math.max(0, diskUsed - edgebricTotal);

  return (
    <div className="flex items-center gap-3">
      <HardDrive className="w-4 h-4 text-slate-400 dark:text-gray-500 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between text-xs mb-1">
          <span className="text-slate-600 dark:text-gray-400">Disk</span>
          <span className="text-slate-500 dark:text-gray-500 font-mono">
            {formatBytes(diskUsed)} / {formatBytes(diskTotal)}
          </span>
        </div>
        <div className="h-1.5 rounded-full bg-slate-100 dark:bg-gray-800 overflow-hidden flex">
          <div className="h-full bg-slate-400 dark:bg-gray-600 transition-all" style={{ width: `${pctOf(otherUsed)}%` }} />
          {modelsSize > 0 && (
            <div className="h-full bg-blue-500 dark:bg-blue-400 transition-all" style={{ width: `${pctOf(modelsSize)}%` }} />
          )}
          {uploadsBytes > 0 && (
            <div className="h-full bg-green-500 dark:bg-green-400 transition-all" style={{ width: `${pctOf(uploadsBytes)}%` }} />
          )}
          {vaultBytes > 0 && (
            <div className="h-full bg-amber-500 dark:bg-amber-400 transition-all" style={{ width: `${pctOf(vaultBytes)}%` }} />
          )}
          {dbBytes > 0 && (
            <div className="h-full bg-violet-500 dark:bg-violet-400 transition-all" style={{ width: `${pctOf(dbBytes)}%` }} />
          )}
        </div>
        <div className="flex items-center gap-3 mt-1.5 flex-wrap">
          {modelsSize > 0 && (
            <span className="flex items-center gap-1 text-[10px] text-slate-500 dark:text-gray-400">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-500 dark:bg-blue-400" />
              AI Models {formatBytes(modelsSize)}
            </span>
          )}
          {uploadsBytes > 0 && (
            <span className="flex items-center gap-1 text-[10px] text-slate-500 dark:text-gray-400">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 dark:bg-green-400" />
              Documents {formatBytes(uploadsBytes)}
            </span>
          )}
          {vaultBytes > 0 && (
            <span className="flex items-center gap-1 text-[10px] text-slate-500 dark:text-gray-400">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 dark:bg-amber-400" />
              Vault {formatBytes(vaultBytes)}
            </span>
          )}
          {dbBytes > 0 && (
            <span className="flex items-center gap-1 text-[10px] text-slate-500 dark:text-gray-400">
              <span className="w-1.5 h-1.5 rounded-full bg-violet-500 dark:bg-violet-400" />
              Database {formatBytes(dbBytes)}
            </span>
          )}
          <span className="flex items-center gap-1 text-[10px] text-slate-500 dark:text-gray-400">
            <span className="w-1.5 h-1.5 rounded-full bg-slate-400 dark:bg-gray-600" />
            Other {formatBytes(otherUsed)}
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Mini RAM Bar (compact, for ModelPicker dropdown) ────────────────────────

export function MiniRAMBar({ system, models, embeddingModel }: {
  system: SystemResources;
  models?: InstalledModel[];
  embeddingModel?: InstalledModel;
}) {
  const ramTotal = system.ramTotalBytes;
  const ramUsed = ramTotal - system.ramAvailableBytes;
  const modelRam = (models ?? [])
    .filter((m) => m.ramUsageBytes)
    .reduce((sum, m) => sum + (m.ramUsageBytes ?? 0), 0);
  const embeddingRam = embeddingModel?.ramUsageBytes ?? 0;
  const serverRam = system.serverRamBytes ?? 0;
  const otherUsed = Math.max(0, ramUsed - modelRam - embeddingRam - serverRam);
  const pctOf = (bytes: number) => ramTotal > 0 ? Math.max(0, (bytes / ramTotal) * 100) : 0;

  return (
    <div className="flex items-center gap-2">
      <MemoryStick className="w-3 h-3 text-slate-400 dark:text-gray-500" />
      <div className="flex-1 h-1 rounded-full bg-slate-100 dark:bg-gray-800 overflow-hidden flex">
        <div className="h-full bg-slate-400 dark:bg-gray-600" style={{ width: `${pctOf(otherUsed)}%` }} />
        {serverRam > 0 && (
          <div className="h-full bg-violet-500 dark:bg-violet-400" style={{ width: `${pctOf(serverRam)}%` }} />
        )}
        {embeddingRam > 0 && (
          <div className="h-full bg-cyan-500 dark:bg-cyan-400" style={{ width: `${pctOf(embeddingRam)}%` }} />
        )}
        {modelRam > 0 && (
          <div className="h-full bg-blue-500 dark:bg-blue-400" style={{ width: `${pctOf(modelRam)}%` }} />
        )}
      </div>
      <span className="text-[10px] text-slate-400 dark:text-gray-500 font-mono tabular-nums">
        {formatBytes(system.ramAvailableBytes)} free
      </span>
    </div>
  );
}
