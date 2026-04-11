/**
 * EditSharkPage — create or edit a shark record.
 *
 * Accessible only to users with editor or admin role.
 * On save the API will stamp updated_by and updated_at automatically,
 * which is visible immediately on the detail page — great for demos.
 *
 * When mode === "create", navigates to the new shark's detail page on success.
 * When mode === "edit",   shows the existing data pre-populated.
 */

import { useEffect } from "react";
import { Link, useParams, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowLeft, Plus, Trash2, Save, Fish } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Navbar } from "@/components/Navbar";
import { useAuth } from "@/lib/auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { CONSERVATION_STATUSES } from "@/lib/utils";
import type { Shark } from "@shared/schema";

type SharkWithArrays = Shark & { dietArr: string[]; funFactsArr: string[] };

// Form schema — accepts array fields as JS arrays (not JSON strings)
const editFormSchema = z.object({
  commonName: z.string().min(2, "Name required"),
  scientificName: z.string().min(2, "Scientific name required"),
  habitat: z.string().min(2, "Habitat required"),
  diet: z.array(z.object({ value: z.string() })).default([]),
  maxLengthM: z.string().optional(),
  maxWeightKg: z.string().optional(),
  conservationStatus: z.string().min(1, "Status required"),
  funFacts: z.array(z.object({ value: z.string() })).default([]),
  imageUrl: z.string().url("Must be a valid URL").optional().or(z.literal("")),
});

type EditFormValues = z.infer<typeof editFormSchema>;

function ArrayField({
  label,
  fieldArray,
  placeholder,
  testPrefix,
}: {
  label: string;
  fieldArray: ReturnType<typeof useFieldArray>;
  placeholder: string;
  testPrefix: string;
}) {
  const { fields, append, remove } = fieldArray;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>{label}</Label>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 text-xs"
          onClick={() => append({ value: "" })}
          data-testid={`btn-add-${testPrefix}`}
        >
          <Plus size={12} className="mr-1" />
          Add
        </Button>
      </div>
      <div className="space-y-2">
        {fields.map((field, idx) => (
          <div key={field.id} className="flex gap-2">
            <Input
              {...(fieldArray.control as any).register(`${testPrefix}.${idx}.value`)}
              placeholder={placeholder}
              className="flex-1 text-sm"
              data-testid={`input-${testPrefix}-${idx}`}
            />
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-9 w-9 text-muted-foreground hover:text-destructive"
              onClick={() => remove(idx)}
              data-testid={`btn-remove-${testPrefix}-${idx}`}
            >
              <Trash2 size={13} />
            </Button>
          </div>
        ))}
        {fields.length === 0 && (
          <p className="text-xs text-muted-foreground pl-1">No items yet. Click Add.</p>
        )}
      </div>
    </div>
  );
}

interface EditSharkFormProps {
  shark?: SharkWithArrays;
  mode: "create" | "edit";
}

function EditSharkForm({ shark, mode }: EditSharkFormProps) {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();

  const form = useForm<EditFormValues>({
    resolver: zodResolver(editFormSchema),
    defaultValues: {
      commonName: "",
      scientificName: "",
      habitat: "",
      diet: [],
      maxLengthM: "",
      maxWeightKg: "",
      conservationStatus: "Not Evaluated",
      funFacts: [],
      imageUrl: "",
    },
  });

  // Pre-fill when editing
  useEffect(() => {
    if (shark && mode === "edit") {
      form.reset({
        commonName: shark.commonName,
        scientificName: shark.scientificName,
        habitat: shark.habitat,
        diet: (shark.dietArr ?? []).map((v) => ({ value: v })),
        maxLengthM: shark.maxLengthM?.toString() ?? "",
        maxWeightKg: shark.maxWeightKg?.toString() ?? "",
        conservationStatus: shark.conservationStatus,
        funFacts: (shark.funFactsArr ?? []).map((v) => ({ value: v })),
        imageUrl: shark.imageUrl ?? "",
      });
    }
  }, [shark]);

  const dietArray = useFieldArray({ control: form.control, name: "diet" });
  const factsArray = useFieldArray({ control: form.control, name: "funFacts" });

  const mutation = useMutation({
    mutationFn: async (values: EditFormValues) => {
      const payload = {
        commonName: values.commonName,
        scientificName: values.scientificName,
        habitat: values.habitat,
        diet: values.diet.map((d) => d.value).filter(Boolean),
        maxLengthM: values.maxLengthM ? parseFloat(values.maxLengthM) : null,
        maxWeightKg: values.maxWeightKg ? parseFloat(values.maxWeightKg) : null,
        conservationStatus: values.conservationStatus,
        funFacts: values.funFacts.map((f) => f.value).filter(Boolean),
        imageUrl: values.imageUrl || null,
        updatedBy: user?.username ?? "editor",
        createdBy: user?.username ?? "editor",
      };

      if (mode === "create") {
        const res = await apiRequest("POST", "/api/sharks", payload);
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error ?? "Failed to create shark");
        }
        return { created: true, data: await res.json() };
      } else {
        const res = await apiRequest("PUT", `/api/sharks/${shark!.id}`, payload);
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error ?? "Failed to update shark");
        }
        return { created: false, data: await res.json() };
      }
    },
    onSuccess: ({ created, data }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/sharks"] });
      queryClient.invalidateQueries({ queryKey: [`/api/sharks/${data.id}`] });
      toast({
        title: created ? "Shark added! 🦈" : "Record updated!",
        description: created
          ? `${data.commonName} has been added to the database.`
          : `${data.commonName} has been updated. Audit fields stamped.`,
      });
      setLocation(`/sharks/${data.id}`);
    },
    onError: (e: Error) =>
      toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const status = form.watch("conservationStatus");

  return (
    <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-6">
      {/* Identity */}
      <Card className="shark-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Fish size={14} className="text-primary" />
            Identity
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 grid sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="commonName">Common Name *</Label>
            <Input
              id="commonName"
              {...form.register("commonName")}
              placeholder="Great White Shark"
              data-testid="input-common-name"
            />
            {form.formState.errors.commonName && (
              <p className="text-xs text-destructive">{form.formState.errors.commonName.message}</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="scientificName">Scientific Name *</Label>
            <Input
              id="scientificName"
              {...form.register("scientificName")}
              placeholder="Carcharodon carcharias"
              className="italic"
              data-testid="input-scientific-name"
            />
            {form.formState.errors.scientificName && (
              <p className="text-xs text-destructive">{form.formState.errors.scientificName.message}</p>
            )}
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="habitat">Habitat *</Label>
            <Input
              id="habitat"
              {...form.register("habitat")}
              placeholder="e.g. Coastal and offshore temperate waters"
              data-testid="input-habitat"
            />
            {form.formState.errors.habitat && (
              <p className="text-xs text-destructive">{form.formState.errors.habitat.message}</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Measurements & Status */}
      <Card className="shark-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Measurements &amp; Status</CardTitle>
        </CardHeader>
        <CardContent className="pt-0 grid sm:grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="maxLengthM">Max Length (m)</Label>
            <Input
              id="maxLengthM"
              type="number"
              step="0.1"
              min="0"
              {...form.register("maxLengthM")}
              placeholder="6.1"
              data-testid="input-max-length"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="maxWeightKg">Max Weight (kg)</Label>
            <Input
              id="maxWeightKg"
              type="number"
              step="1"
              min="0"
              {...form.register("maxWeightKg")}
              placeholder="2268"
              data-testid="input-max-weight"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Conservation Status *</Label>
            <Select
              value={status}
              onValueChange={(v) => form.setValue("conservationStatus", v)}
            >
              <SelectTrigger data-testid="select-conservation-status">
                <SelectValue placeholder="Select status" />
              </SelectTrigger>
              <SelectContent>
                {CONSERVATION_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Diet & Fun Facts */}
      <Card className="shark-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Diet &amp; Fun Facts</CardTitle>
        </CardHeader>
        <CardContent className="pt-0 grid sm:grid-cols-2 gap-6">
          <ArrayField
            label="Diet Items"
            fieldArray={dietArray as any}
            placeholder="e.g. fish"
            testPrefix="diet"
          />
          <ArrayField
            label="Fun Facts"
            fieldArray={factsArray as any}
            placeholder="An amazing fact…"
            testPrefix="funFacts"
          />
        </CardContent>
      </Card>

      {/* Image */}
      <Card className="shark-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Image URL</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <Input
            {...form.register("imageUrl")}
            placeholder="https://example.com/shark.jpg"
            data-testid="input-image-url"
          />
          {form.formState.errors.imageUrl && (
            <p className="text-xs text-destructive mt-1">{form.formState.errors.imageUrl.message}</p>
          )}
          <p className="text-xs text-muted-foreground mt-1.5">
            Must be a publicly accessible image URL (HTTPS recommended).
          </p>
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex items-center gap-3">
        <Button
          type="submit"
          disabled={mutation.isPending}
          className="flex items-center gap-2"
          data-testid="btn-save-shark"
        >
          <Save size={14} />
          {mutation.isPending
            ? "Saving…"
            : mode === "create"
            ? "Add Shark"
            : "Save Changes"}
        </Button>
        <Link href={mode === "edit" && shark ? `/sharks/${shark.id}` : "/search"}>
          <a>
            <Button type="button" variant="ghost" data-testid="btn-cancel">
              Cancel
            </Button>
          </a>
        </Link>
        {mode === "edit" && (
          <p className="text-xs text-muted-foreground ml-auto">
            Saving will update the audit fields with your username and current timestamp.
          </p>
        )}
      </div>
    </form>
  );
}

// --- Page wrapper ----------------------------------------------------------

export default function EditSharkPage() {
  const { id } = useParams<{ id?: string }>();
  const { isEditor, isAdmin } = useAuth();
  const [, setLocation] = useLocation();
  const mode = id ? "edit" : "create";

  // Redirect non-editors
  if (!isEditor && !isAdmin) {
    setLocation("/search");
    return null;
  }

  const { data: shark, isLoading } = useQuery<SharkWithArrays>({
    queryKey: [`/api/sharks/${id}`],
    enabled: !!id,
  });

  return (
    <div className="min-h-screen shark-gradient">
      <Navbar />
      <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 py-8 fade-in">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <Link href={mode === "edit" && id ? `/sharks/${id}` : "/search"}>
            <a className="text-muted-foreground hover:text-foreground transition-colors">
              <ArrowLeft size={16} />
            </a>
          </Link>
          <div>
            <h1 className="text-xl font-bold">
              {mode === "create" ? "Add New Shark" : "Edit Shark Record"}
            </h1>
            <p className="text-sm text-muted-foreground">
              {mode === "create"
                ? "Add a new species to the database."
                : "Changes will be stamped with your username and timestamp."}
            </p>
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-40 w-full rounded-lg" />
            <Skeleton className="h-40 w-full rounded-lg" />
          </div>
        ) : (
          <EditSharkForm shark={shark} mode={mode} />
        )}
      </div>
    </div>
  );
}
