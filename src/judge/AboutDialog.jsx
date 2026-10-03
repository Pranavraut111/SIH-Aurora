/* ═══════════════════════════════════════════════════════════════
   Aurora — About Aurora (Help → About, ⋮ → About). Loaded on demand.
   The problem, the architecture in a paragraph, the data provenance policy,
   what is simulated and why, the source code, and the team (placeholders for
   the team to fill in).
   ═══════════════════════════════════════════════════════════════ */
import { Box, Dialog, DialogContent, DialogTitle, IconButton, Link, Typography } from '@mui/material';
import CloseOutlined from '@mui/icons-material/CloseOutlined';
import ProvenanceChip from '../ui/Provenance';

const REPO_URL = 'https://github.com/Saeesh-Vele/SIH2026A';

// Team credits: placeholders for the team to fill in (name — role).
const TEAM = ['Team member 1 — role', 'Team member 2 — role', 'Team member 3 — role', 'Team member 4 — role', 'Team member 5 — role', 'Team member 6 — role'];

function Section({ title, children, id }) {
  return (
    <Box component="section" aria-labelledby={id} sx={{ mb: 4 }}>
      <Typography id={id} component="h3" sx={{ fontWeight: 600, fontSize: 15, mb: 1 }}>{title}</Typography>
      {children}
    </Box>
  );
}

const P = ({ children }) => <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1.5 }}>{children}</Typography>;

export default function AboutDialog({ open, onClose, focus }) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth scroll="paper" aria-labelledby="about-title"
      slotProps={{ paper: { 'data-testid': 'about-dialog' } }}>
      <DialogTitle id="about-title" sx={{ display: 'flex', alignItems: 'center' }}>
        <Box component="span" sx={{ flex: 1 }}>About Aurora</Box>
        <IconButton onClick={onClose} aria-label="Close About Aurora"><CloseOutlined /></IconButton>
      </DialogTitle>
      <DialogContent dividers>
        <Section title="The problem" id="about-problem">
          <P>Smart India Hackathon problem statement 26060 (Ministry of Earth Sciences / NCPOR): efficient management of remote research stations.
            India runs two year-round stations in Antarctica, Maitri (Schirmacher Oasis, since 1989) and Bharati (Larsemann Hills, since 2012).
            Power, heat, water and supplies must be planned months ahead, with a small crew, unreliable links and a single resupply season.</P>
        </Section>
        <Section title="How Aurora works" id="about-architecture">
          <P>A simulator drives a physics model of each station (generator, heating, water treatment, communications) with ERA5 reanalysis weather (past weather rebuilt from observations by ECMWF)
            replayed for the station&apos;s coordinates. A FastAPI backend evaluates every reading against configurable thresholds, follows failures
            through the station&apos;s dependency graph, and serves the dashboard over REST and a WebSocket. An Isolation Forest (a machine-learning anomaly detector) scores how far
            the readings are from what the model expects, a rule-based decision engine recommends actions, and a language model (when available) explains them;
            otherwise an offline summary is shown, and labelled as such.</P>
        </Section>
        <Section title="Where the data comes from (provenance)" id="about-provenance">
          {/* On the page background (not the dialog's lighter surface) the chips keep AA contrast. */}
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 1.5, p: 2, borderRadius: '8px', bgcolor: 'background.default' }} data-testid="about-provenance" tabIndex={focus === 'provenance' ? -1 : undefined}>
            <ProvenanceChip kind="REAL" /><ProvenanceChip kind="REANALYSIS" /><ProvenanceChip kind="MODEL-DERIVED" />
            <ProvenanceChip kind="SIMULATED" /><ProvenanceChip kind="OPERATOR-ENTERED" />
          </Box>
          <P>Every value carries one of these labels. Real: weather station observations from NCPOR&apos;s public AWS pages, fetched every 30 minutes and checked for plausibility. Reanalysis: ERA5 weather
            (ECMWF), not a live feed. Model-derived: computed by the physics model. Simulated: injected demo faults and test mode. Operator-entered:
            the logistics ledger. Nothing is presented as more real than it is.</P>
        </Section>
        <Section title="What is simulated, and why" id="about-simulated">
          <P>There is no live telemetry from the stations&apos; equipment available to us, so the equipment readings come from the physics model, and
            faults are injected by the simulator for demonstration. Station layouts in 3D are schematic. Remote commands are recorded, never sent. The satellite link and its outages are
            simulated too, to show how a station would store its readings during an outage and send them when the link returns.
            On this public site, demo scenarios are shared and reset after two minutes, and each visitor&apos;s changes stay in a private one-hour sandbox.</P>
        </Section>
        <Section title="Source code" id="about-source">
          <P><Link href={REPO_URL} target="_blank" rel="noopener noreferrer">{REPO_URL.replace('https://', '')}</Link></P>
        </Section>
        <Section title="Team" id="about-team">
          <Box component="ul" sx={{ m: 0, pl: 3, color: 'text.secondary', typography: 'body2' }} data-testid="about-team">
            {TEAM.map((m) => <li key={m}>{m}</li>)}
          </Box>
        </Section>
      </DialogContent>
    </Dialog>
  );
}
