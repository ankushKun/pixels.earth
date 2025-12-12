import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "./ui/dialog";
import { Label } from "./ui/label";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { getNickname, setNickname as saveNickname } from "@/hooks/use-gun-presence";
import { toast } from "sonner";

export function SettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
    const [nickname, setNickname] = useState("");

    useEffect(() => {
        if (open) {
            setNickname(getNickname() || "");
        }
    }, [open]);

    const handleSave = () => {
        const trimmed = nickname.trim();
        saveNickname(trimmed || null);
        toast.success("Settings saved");
        onOpenChange(false);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[425px] bg-white text-slate-900">
                <DialogHeader>
                    <DialogTitle>Settings</DialogTitle>
                    <DialogDescription>
                        Make changes to your profile here.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="nickname" className="text-right">
                            Nickname
                        </Label>
                        <Input
                            id="nickname"
                            value={nickname}
                            onChange={(e) => setNickname(e.target.value)}
                            className="col-span-3"
                            maxLength={20}
                            placeholder="Display name"
                        />
                    </div>
                </div>
                <DialogFooter>
                    <Button type="submit" onClick={handleSave}>Save changes</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
