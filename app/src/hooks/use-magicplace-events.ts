import { useEffect } from "react";
import { useMagicplaceProgram } from "./use-magicplace-program";
import { useConnection } from "@solana/wallet-adapter-react";
import { EventParser } from "@coral-xyz/anchor";

export function useMagicplaceEvents(
    onPixelChange?: (data: any) => void,
    onShardInit?: (data: any) => void
) {
    const { readOnlyProgram, readOnlyErProgram, erConnection } = useMagicplaceProgram();
    const { connection } = useConnection();

    useEffect(() => {
        const listeners: Array<{ program: any, id: number }> = [];
        let rawLogId: number | null = null;
        let baseLogId: number | null = null;
        
        /*
        console.log("🔌 Setting up event listeners...", { 
            hasBaseProgram: !!readOnlyProgram, 
            hasERProgram: !!readOnlyErProgram,
            hasERConnection: !!erConnection,
            hasBaseConnection: !!connection
        });
        */

        // Wrapper to ensure we only process relevant events
        const handlePixelChange = (event: any) => {
             // console.log("🔥 Pixel Changed event received:", event);
             if (onPixelChange) onPixelChange(event);
        };
        const handleShardInit = (event: any) => {
             // console.log("💎 Shard Init event received:", event);
             if (onShardInit) onShardInit(event);
        };

        // Manual Parser Logic
        const processLogs = (logs: any, program: any, label: string) => {
             if (!program || !logs.logs) return;
             try {
                const parser = new EventParser(program.programId, program.coder);
                for (const event of parser.parseLogs(logs.logs)) {
                    // console.log(`MANUAL DECODE (${label}):`, event);
                    if (event.name === "pixelChanged") {
                        handlePixelChange(event.data);
                    } else if (event.name === "shardInitialized") {
                        handleShardInit(event.data);
                    }
                }
            } catch (parseErr) {
                console.warn(`Manual parsing failed (${label}):`, parseErr);
            }
        };

        // Raw listener debug & MANUAL PARSING (ER)
        if (erConnection && readOnlyErProgram) {
            try {
                rawLogId = erConnection.onLogs(
                    readOnlyErProgram.programId, 
                    (logs, ctx) => processLogs(logs, readOnlyErProgram, "ER"), 
                    "confirmed"
                );
                // console.log("DEBUG: Subscribed to Raw ER Logs", rawLogId);
            } catch (e) {
                console.warn("DEBUG: Failed to subscribe to raw logs ER", e);
            }
        }
        
        // Raw listener debug & MANUAL PARSING (Base Layer)
        if (connection && readOnlyProgram) {
            try {
                baseLogId = connection.onLogs(
                    readOnlyProgram.programId, 
                    (logs, ctx) => processLogs(logs, readOnlyProgram, "Base"), 
                    "confirmed"
                );
                // console.log("DEBUG: Subscribed to Raw Base Logs", baseLogId);
            } catch (e) {
                console.warn("DEBUG: Failed to subscribe to raw logs Base", e);
            }
        }

        const subscribe = (prog: any, label: string) => {
            if (!prog) return;
            try {
                // Subscribe to PixelChanged
                const l1 = prog.addEventListener("pixelChanged", handlePixelChange);
                listeners.push({ program: prog, id: l1 });
                
                // Subscribe to ShardInitialized
                const l2 = prog.addEventListener("shardInitialized", handleShardInit);
                listeners.push({ program: prog, id: l2 });
                
                // console.log(`Subscribed to events on ${label}`);
            } catch (e) {
                console.warn(`Failed to subscribe to events on ${label}:`, e);
            }
        };

        // Subscribe to Base Layer (Stable ReadOnly)
        subscribe(readOnlyProgram, "Base Layer");
        
        // Subscribe to ER (Stable ReadOnly)
        subscribe(readOnlyErProgram, "ER");

        return () => {
             listeners.forEach(({ program, id }) => {
                try {
                    program.removeEventListener(id).catch((e: any) => console.warn("Error removing listener:", e));
                } catch (e) {
                     // ignore
                }
            });
            
            if (rawLogId !== null && erConnection) {
                erConnection.removeOnLogsListener(rawLogId).catch(console.error);
            }
            if (baseLogId !== null && connection) {
                connection.removeOnLogsListener(baseLogId).catch(console.error);
            }
        };

    }, [readOnlyProgram, readOnlyErProgram, erConnection, connection, onPixelChange, onShardInit]);
}
