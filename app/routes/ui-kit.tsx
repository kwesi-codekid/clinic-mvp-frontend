import { useState } from "react";
import { ActivityIcon, CircleAlertIcon, PlusIcon } from "lucide-react";
import { toast } from "sonner";

import { ThemeToggle } from "~/components/theme-toggle";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Avatar, AvatarFallback } from "~/components/ui/avatar";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { Checkbox } from "~/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Progress } from "~/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Separator } from "~/components/ui/separator";
import { Switch } from "~/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { Textarea } from "~/components/ui/textarea";
import type { Route } from "./+types/ui-kit";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Medical App" },
    { name: "description", content: "shadcn/ui component kit" },
  ];
}

const appointments = [
  { id: "A-1042", patient: "Ama Boateng", type: "Follow-up", status: "Confirmed" },
  { id: "A-1043", patient: "Kofi Mensah", type: "Lab review", status: "Waiting" },
  { id: "A-1044", patient: "Yaa Owusu", type: "Intake", status: "Cancelled" },
] as const;

const statusVariant = {
  Confirmed: "default",
  Waiting: "secondary",
  Cancelled: "destructive",
} as const;

export default function Home() {
  const [notify, setNotify] = useState(true);

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Avatar>
            <AvatarFallback>MA</AvatarFallback>
          </Avatar>
          <div>
            <h1 className="text-lg font-semibold">Medical App</h1>
            <p className="text-sm text-muted-foreground">
              shadcn/ui is wired up and ready.
            </p>
          </div>
        </div>
        <ThemeToggle />
      </header>

      <Separator />

      <Alert>
        <CircleAlertIcon />
        <AlertTitle>Component kit installed</AlertTitle>
        <AlertDescription>
          Add more with <code>npx shadcn@latest add &lt;name&gt;</code>.
        </AlertDescription>
      </Alert>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="schedule">Schedule</TabsTrigger>
          <TabsTrigger value="form">Form</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4 pt-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Today's capacity</CardTitle>
                <CardDescription>18 of 26 slots booked</CardDescription>
              </CardHeader>
              <CardContent>
                <Progress value={69} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Buttons</CardTitle>
                <CardDescription>Every variant renders</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                <Button>Default</Button>
                <Button variant="secondary">Secondary</Button>
                <Button variant="outline">Outline</Button>
                <Button variant="ghost">Ghost</Button>
                <Button variant="destructive">Destructive</Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="schedule" className="space-y-4 pt-4">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-medium">
              <ActivityIcon className="size-4" />
              Upcoming appointments
            </h2>
            <Dialog>
              <DialogTrigger render={<Button size="sm" />}>
                <PlusIcon />
                New
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>New appointment</DialogTitle>
                  <DialogDescription>
                    Dialogs, overlays and focus trapping all work.
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-2">
                  <Label htmlFor="patient">Patient</Label>
                  <Input id="patient" placeholder="Full name" />
                </div>
                <DialogFooter showCloseButton>
                  <Button onClick={() => toast.success("Appointment created")}>
                    Save
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ref</TableHead>
                <TableHead>Patient</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {appointments.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-mono text-xs">{a.id}</TableCell>
                  <TableCell>{a.patient}</TableCell>
                  <TableCell>{a.type}</TableCell>
                  <TableCell>
                    <Badge variant={statusVariant[a.status]}>{a.status}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TabsContent>

        <TabsContent value="form" className="pt-4">
          <Card>
            <CardHeader>
              <CardTitle>Patient intake</CardTitle>
              <CardDescription>Form primitives, unstyled by you</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="name">Full name</Label>
                <Input id="name" placeholder="Jane Doe" />
              </div>
              <div className="grid gap-2">
                <Label>Department</Label>
                <Select>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select a department" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cardiology">Cardiology</SelectItem>
                    <SelectItem value="pediatrics">Pediatrics</SelectItem>
                    <SelectItem value="radiology">Radiology</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="notes">Notes</Label>
                <Textarea id="notes" placeholder="Presenting symptoms…" />
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="consent" />
                <Label htmlFor="consent">Consent on file</Label>
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="notify">Email reminders</Label>
                <Switch
                  id="notify"
                  checked={notify}
                  onCheckedChange={setNotify}
                />
              </div>
              <Button
                className="w-fit"
                onClick={() => toast("Intake saved", { description: "Toaster works too." })}
              >
                Submit
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </main>
  );
}
