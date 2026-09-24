import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Image as ImageIcon, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { imagesApi, usersApi } from "@/lib/api";

export function AddUserDialog({
  open,
  onOpenChange,
  initialObjectKey = null,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialObjectKey?: string | null;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [selectedImage, setSelectedImage] = useState<string | null>(initialObjectKey);

  const { data: recentImages = [], isLoading: imagesLoading } = useQuery({
    queryKey: ["recent-images-enroll"],
    queryFn: () => imagesApi.list(10, false),
    enabled: open,
  });

  useEffect(() => {
    if (open) setSelectedImage(initialObjectKey);
  }, [initialObjectKey, open]);

  const enrollMutation = useMutation({
    mutationFn: () => usersApi.enrollFace(name, selectedImage!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      toast.success("User enrolled successfully!");
      onOpenChange(false);
      setName("");
      setSelectedImage(null);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Enrollment failed"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-125">
        <DialogHeader><DialogTitle>Enroll New User</DialogTitle></DialogHeader>
        <div className="space-y-6 pt-4">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">User Full Name</span>
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Jane Doe" className="h-10" />
          </label>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Select Recent Camera Image</span>
              <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => qc.invalidateQueries({ queryKey: ["recent-images-enroll"] })}>Refresh</Button>
            </div>
            {imagesLoading ? (
              <div className="flex justify-center p-4"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : recentImages.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                <ImageIcon className="mx-auto mb-2 h-6 w-6 opacity-40" />
                No recent images. Ask the user to stand in front of the camera.
              </div>
            ) : (
              <div className="grid max-h-50 grid-cols-5 gap-2 overflow-y-auto pr-1">
                {recentImages.map((image) => (
                  <button
                    type="button"
                    key={image.objectKey}
                    onClick={() => setSelectedImage(image.objectKey)}
                    className={`relative aspect-square cursor-pointer overflow-hidden rounded-md border-2 transition-all ${selectedImage === image.objectKey ? "border-primary shadow-sm" : "border-transparent opacity-70 hover:opacity-100"}`}
                  >
                    <img src={imagesApi.getUrl(image.objectKey)} alt="Capture" className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-lg border border-warning/20 bg-warning/10 p-3 text-xs text-warning-foreground">
            <strong>Note:</strong> The new user will be created with &quot;INACTIVE&quot; status by default for security. You can enable their access from the user list.
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button disabled={!name || !selectedImage || enrollMutation.isPending} onClick={() => enrollMutation.mutate()} className="gap-2">
              {enrollMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Enroll Face
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
