import { useState } from "react";
import { X, FileText } from "lucide-react";
import { supabase } from "../supabaseClient";
import { Modal, Field, inputCls, Btn } from "./ui";
import { todayStr, fmtMoney } from "../lib/helpers";

export function OfferLetterModal({ employee, onClose }) {
  const [f, setF] = useState({
    letter_number: "",
    issue_date: todayStr(),
    father_husband_name: "",
    address: "",
    designation: employee.role || "",
    department: employee.department || "",
    employment_type: "Regular",
    joining_date: employee.join_date || todayStr(),
    reporting_manager: "",
    basic_salary: "",
    da_allowance: "",
    attendance_allowance: "",
    other_deductions: "",
    probation_months: 3,
    notice_period_days: 30,
    weekly_off: "Sunday",
  });
  const [saving, setSaving] = useState(false);
  const [letter, setLetter] = useState(null);

  const generate = async (e) => {
    e.preventDefault();
    setSaving(true);
    const payload = {
      employee_id: employee.id,
      ...f,
      basic_salary: Number(f.basic_salary) || 0,
      da_allowance: Number(f.da_allowance) || 0,
      attendance_allowance: Number(f.attendance_allowance) || 0,
      other_deductions: Number(f.other_deductions) || 0,
      probation_months: Number(f.probation_months) || 0,
      notice_period_days: Number(f.notice_period_days) || 0,
    };
    const { data, error } = await supabase.from("offer_letters").insert(payload).select().single();
    setSaving(false);
    if (error) {
      alert(`Couldn't generate letter:\n${error.message}`);
      return;
    }
    setLetter(data);
  };

  if (letter) {
    return <PrintOfferLetter letter={letter} employeeName={employee.name} onClose={onClose} />;
  }

  return (
    <Modal title={`Offer letter — ${employee.name}`} onClose={onClose}>
      <form onSubmit={generate}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Letter number">
            <input className={inputCls} placeholder="e.g. TP/HR/2026/014" value={f.letter_number} onChange={(e) => setF({ ...f, letter_number: e.target.value })} />
          </Field>
          <Field label="Issue date">
            <input type="date" className={inputCls} value={f.issue_date} onChange={(e) => setF({ ...f, issue_date: e.target.value })} />
          </Field>
        </div>
        <Field label="Father's / Husband's name">
          <input className={inputCls} value={f.father_husband_name} onChange={(e) => setF({ ...f, father_husband_name: e.target.value })} />
        </Field>
        <Field label="Address">
          <textarea rows={2} className={inputCls} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Designation / Position">
            <input className={inputCls} value={f.designation} onChange={(e) => setF({ ...f, designation: e.target.value })} />
          </Field>
          <Field label="Department">
            <input className={inputCls} value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Employment type">
            <select className={inputCls} value={f.employment_type} onChange={(e) => setF({ ...f, employment_type: e.target.value })}>
              <option value="Regular">రెగ్యులర్ (Regular)</option>
              <option value="Probation">ప్రొబేషన్ (Probation)</option>
              <option value="Contract">కాంట్రాక్ట్ (Contract)</option>
            </select>
          </Field>
          <Field label="Joining date">
            <input type="date" className={inputCls} value={f.joining_date} onChange={(e) => setF({ ...f, joining_date: e.target.value })} />
          </Field>
        </div>
        <Field label="Reporting manager">
          <input className={inputCls} value={f.reporting_manager} onChange={(e) => setF({ ...f, reporting_manager: e.target.value })} />
        </Field>

        <div className="border-t border-stone-200 my-3 pt-3">
          <span className="block text-xs font-semibold text-stone-700 mb-2">Salary breakup (monthly)</span>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Basic salary (₹)">
              <input type="number" min="0" className={inputCls} value={f.basic_salary} onChange={(e) => setF({ ...f, basic_salary: e.target.value })} />
            </Field>
            <Field label="DA / other allowance (₹)">
              <input type="number" min="0" className={inputCls} value={f.da_allowance} onChange={(e) => setF({ ...f, da_allowance: e.target.value })} />
            </Field>
            <Field label="Attendance allowance (₹)">
              <input type="number" min="0" className={inputCls} value={f.attendance_allowance} onChange={(e) => setF({ ...f, attendance_allowance: e.target.value })} />
            </Field>
            <Field label="PF / ESI deductions (₹)">
              <input type="number" min="0" className={inputCls} value={f.other_deductions} onChange={(e) => setF({ ...f, other_deductions: e.target.value })} />
            </Field>
          </div>
          <p className="text-xs text-stone-400 mt-1">
            Gross = Basic + DA + Attendance allowance. Net = Gross − deductions. Calculated automatically on the letter.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Field label="Probation (months)">
            <input type="number" min="0" className={inputCls} value={f.probation_months} onChange={(e) => setF({ ...f, probation_months: e.target.value })} />
          </Field>
          <Field label="Notice period (days)">
            <input type="number" min="0" className={inputCls} value={f.notice_period_days} onChange={(e) => setF({ ...f, notice_period_days: e.target.value })} />
          </Field>
          <Field label="Weekly off">
            <input className={inputCls} value={f.weekly_off} onChange={(e) => setF({ ...f, weekly_off: e.target.value })} />
          </Field>
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn type="submit" disabled={saving}>{saving ? "Generating…" : "Generate letter"}</Btn>
        </div>
      </form>
    </Modal>
  );
}

function PrintOfferLetter({ letter, employeeName, onClose }) {
  const gross = Number(letter.basic_salary) + Number(letter.da_allowance) + Number(letter.attendance_allowance);
  const net = gross - Number(letter.other_deductions);
  const empTypeTelugu = { Regular: "రెగ్యులర్", Probation: "ప్రొబేషన్", Contract: "కాంట్రాక్ట్" }[letter.employment_type] || letter.employment_type;

  return (
    <div className="fixed inset-0 bg-white text-stone-900 z-50 overflow-auto">
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #print-offer, #print-offer * { visibility: visible; }
          #print-offer { position: absolute; top: 0; left: 0; width: 100%; padding: 20px; }
          .no-print { display: none !important; }
        }
      `}</style>
      <div className="no-print sticky top-0 flex justify-end gap-2 bg-stone-100 border-b border-stone-200 p-2">
        <Btn variant="ghost" onClick={onClose}><X size={14} /> Close</Btn>
        <Btn onClick={() => window.print()}><FileText size={14} /> Print</Btn>
      </div>

      <div id="print-offer" className="max-w-2xl mx-auto p-8 text-[13px] leading-relaxed">
        <div className="text-center border-b-2 border-stone-800 pb-3 mb-4">
          <img src="/logo-mark-navy.png" alt="" className="h-12 mx-auto mb-1" />
          <h1 className="text-xl font-extrabold">T&P TEXTILES</h1>
          <p className="text-sm text-stone-600">GARMENTS MANUFACTURING UNIT</p>
        </div>

        <h2 className="text-center text-lg font-bold mb-4">ఉద్యోగ నియామక / ఆఫర్ లెటర్</h2>

        <div className="flex justify-between text-sm mb-4">
          <span>లేఖ సంఖ్య: {letter.letter_number || "—"}</span>
          <span>తేదీ: {letter.issue_date}</span>
        </div>

        <div className="text-sm mb-4 space-y-1">
          <p>ఉద్యోగి పేరు: <b>{employeeName}</b></p>
          <p>తండ్రి / తల్లి పేరు: {letter.father_husband_name || "—"}</p>
          <p>చిరునామా: {letter.address || "—"}</p>
        </div>

        <div className="text-sm mb-4 space-y-1 border-y border-stone-300 py-2">
          <p>పదవి: {letter.designation || "—"}</p>
          <p>విభాగం: {letter.department || "—"}</p>
          <p>ఉద్యోగ రకం: {empTypeTelugu}</p>
          <p>చేరే తేదీ: {letter.joining_date}</p>
          <p>రిపోర్టింగ్ మేనేజర్: {letter.reporting_manager || "—"}</p>
        </div>

        <p className="mb-3">ప్రియమైన శ్రీ / శ్రీమతి <b>{employeeName}</b> గారికి,</p>
        <p className="mb-4">
          మీ దరఖాస్తు మరియు ఇంటర్వ్యూ ఆధారంగా, T&amp;P Textiles సంస్థలో పై పేర్కొన్న పదవికి మిమ్మల్ని నియమించడానికి మేము సంతోషిస్తున్నాము.
          ఈ నియామకం క్రింది నిబంధనలు మరియు షరతులకు లోబడి ఉంటుంది.
        </p>

        <Section n="1" title="ఉద్యోగ బాధ్యతలు">
          <p>మీకు అప్పగించిన పని మీ పదవికి అనుగుణంగా సమయానికి మరియు నాణ్యతా ప్రమాణాలకు అనుగుణంగా పూర్తి చేయాలి.</p>
          <p>గార్మెంట్ తయారీ యూనిట్‌లో అవసరాన్ని బట్టి Cutting, Stitching, Checking, Finishing, Ironing, Packing, Printing మరియు ఇతర సంబంధిత పనుల్లో పని చేయవలసి ఉంటుంది.</p>
          <p>మేనేజ్‌మెంట్ ఇచ్చే చట్టబద్ధమైన పని సంబంధిత సూచనలను ఉద్యోగి తప్పనిసరిగా పాటించాలి.</p>
        </Section>

        <Section n="2" title="జీతం / వేతనం">
          <p className="mb-2">మీ నెలవారీ వేతనం క్రింది విధంగా ఉంటుంది: మొత్తం నెలవారీ జీతం: ₹{fmtMoney(gross).replace("₹", "")}</p>
          <table className="w-full border border-stone-400 border-collapse mb-2">
            <tbody>
              <Row label="ప్రాథమిక వేతనం (Basic)" value={fmtMoney(letter.basic_salary)} />
              <Row label="DA / ఇతర Allowance" value={fmtMoney(letter.da_allowance)} />
              <Row label="హాజరు / ఇతర Allowance" value={fmtMoney(letter.attendance_allowance)} />
              <Row label="మొత్తం Gross Salary" value={fmtMoney(gross)} bold />
              <Row label="PF / ESI / ఇతర చట్టబద్ధమైన మినహాయింపులు" value={fmtMoney(letter.other_deductions)} />
              <Row label="చేతికి వచ్చే జీతం (Net Salary)" value={fmtMoney(net)} bold />
            </tbody>
          </table>
          <p>జీతం సంస్థ యొక్క పేరోల్ విధానం ప్రకారం ప్రతి నెల చెల్లించబడుతుంది. వర్తించే PF, ESI, Professional Tax, TDS మరియు ఇతర చట్టబద్ధమైన మినహాయింపులు వర్తించవచ్చు.</p>
        </Section>

        <Section n="3" title="ప్రొబేషన్">
          <p>ఉద్యోగి మొదటి {letter.probation_months} నెలలు ప్రొబేషన్ కాలంలో ఉంటారు.</p>
          <p>ఈ కాలంలో ఉద్యోగి యొక్క పని నాణ్యత, హాజరు, ప్రవర్తన, క్రమశిక్షణ, ఉత్పాదకత మరియు బాధ్యతలను పరిశీలిస్తారు.</p>
          <p>పని సంతృప్తికరంగా ఉంటే ఉద్యోగాన్ని కొనసాగించడం / నిర్ధారించడం గురించి సంస్థ నిర్ణయం తీసుకుంటుంది.</p>
        </Section>

        <Section n="4" title="పని సమయం / Shift Timings">
          <p>సాధారణ పని సమయం: ఉదయం 9:00 గంటల నుండి సాయంత్రం 6:00 గంటల వరకు. భోజన విరామం: 1 గంట.</p>
          <p>పని అవసరాన్ని బట్టి మేనేజ్‌మెంట్ షిఫ్ట్ సమయాలను మార్చవచ్చు లేదా అదనపు షిఫ్ట్ ఏర్పాటు చేయవచ్చు.</p>
          <p>షిఫ్ట్ మార్పు, వారపు సెలవు మరియు పని సమయాలు సంస్థ అవసరాలు మరియు వర్తించే కార్మిక చట్టాలకు అనుగుణంగా నిర్వహించబడతాయి.</p>
          <p>అనుమతి లేకుండా షిఫ్ట్ ప్రారంభ సమయానికి ఆలస్యంగా రావడం లేదా పని మధ్యలో వెళ్లిపోవడం హాజరు / క్రమశిక్షణ సమస్యగా పరిగణించబడుతుంది.</p>
        </Section>

        <Section n="5" title="హాజరు మరియు సెలవులు">
          <p>ఉద్యోగి ప్రతిరోజూ సమయానికి హాజరు కావాలి. సెలవు అవసరమైతే సాధ్యమైనంత ముందుగా Supervisor / Manager నుండి అనుమతి తీసుకోవాలి.</p>
          <p>అనుమతి లేకుండా వరుసగా గైర్హాజరు కావడం క్రమశిక్షణా చర్యకు కారణం కావచ్చు.</p>
          <p>వారపు సెలవులు మరియు చట్టబద్ధమైన సెలవులు సంస్థ Leave Policy మరియు వర్తించే చట్టాల ప్రకారం ఉంటాయి. వారపు సెలవు: {letter.weekly_off}.</p>
        </Section>

        <Section n="6" title="ఉత్పత్తి మరియు పని సామర్థ్యం">
          <p>గార్మెంట్ పరిశ్రమలో ప్రతి విభాగానికి నిర్ణయించబడిన ఉత్పత్తి లక్ష్యాలు ఉంటాయి. ఉద్యోగి తనకు కేటాయించిన పనిని నిర్ణయించిన సమయానికి, నిర్దేశించిన పరిమాణంలో, సరైన నాణ్యతతో, తక్కువ రీవర్క్ / రిజెక్షన్‌తో పూర్తి చేయడానికి బాధ్యత వహించాలి.</p>
          <p>ఉత్పత్తి లక్ష్యాలు ఆర్డర్, garment type, operation difficulty, machine మరియు పని పరిస్థితులను బట్టి మేనేజ్‌మెంట్ నిర్ణయిస్తుంది.</p>
        </Section>

        <Section n="7" title="Sewing Machine / Factory Equipment వినియోగం">
          <p>ఉద్యోగికి కేటాయించిన sewing machine లేదా ఇతర యంత్రాలను జాగ్రత్తగా ఉపయోగించాలి. Machine‌ను అనుమతి లేకుండా ఇతరులకు ఇవ్వకూడదు, వ్యక్తిగత పనులకు ఉపయోగించకూడదు, ఉద్దేశపూర్వకంగా damage చేయకూడదు, Safety guards తొలగించి ఉపయోగించకూడదు.</p>
          <p>Machineలో abnormal sound / problem కనిపిస్తే వెంటనే Supervisor / Mechanicకు తెలియజేయాలి. ఉద్దేశపూర్వక నిర్లక్ష్యం లేదా దుర్వినియోగం వల్ల జరిగిన నష్టంపై సంస్థ తన disciplinary policy మరియు వర్తించే చట్టాల ప్రకారం చర్య తీసుకోవచ్చు.</p>
        </Section>

        <Section n="8" title="Buttons, Zips, Labels మరియు ఇతర Accessories">
          <p>Buttons, zips, labels, elastic, thread, tags, packing materials మరియు ఇతర production accessories సంస్థకు చెందినవి. ఉద్యోగి అవసరమైన పరిమాణంలో మాత్రమే material తీసుకోవాలి, వృథా కాకుండా జాగ్రత్తగా ఉపయోగించాలి, మిగిలిన material‌ను తిరిగి ఇవ్వాలి.</p>
          <p>Material‌ను ఇంటికి తీసుకెళ్లడం లేదా వ్యక్తిగతంగా ఉపయోగించడం నిషేధం. ఉద్దేశపూర్వకంగా దుర్వినియోగం / దొంగతనం జరిగితే సంస్థ disciplinary procedure ప్రకారం చర్య తీసుకోవచ్చు.</p>
        </Section>

        <Section n="9" title="Company Property">
          <p>Machine, scissors, cutting tools, measuring tools, iron, computer, ID card, uniform, documents, samples, fabric, accessories, files మరియు ఇతర కంపెనీ ఆస్తులు సంస్థకు చెందినవి. ఉద్యోగం ముగిసినప్పుడు లేదా సంస్థ కోరినప్పుడు అన్ని కంపెనీ ఆస్తులను తిరిగి అప్పగించాలి.</p>
        </Section>

        <Section n="10" title="Safety Rules">
          <p>Factoryలో safety rules తప్పనిసరిగా పాటించాలి — Machine safety, electrical safety, fire safety, needle safety మరియు ఇతర procedures. అందించిన PPE సరైన విధంగా ఉపయోగించాలి. ఉద్దేశపూర్వకంగా ఉల్లంఘించడం disciplinary actionకు కారణం కావచ్చు.</p>
        </Section>

        <Section n="11" title="నాణ్యత (Quality)">
          <p>ప్రతి garment సంస్థ నిర్దేశించిన quality standards ప్రకారం తయారు చేయాలి. Needle damage, open seam, loose thread, wrong measurement, wrong label, wrong size, stain, printing defect లేదా ఇతర defects కనిపిస్తే వెంటనే Supervisor / Quality Departmentకు తెలియజేయాలి. నాణ్యతను దాచిపెట్టి defective garments‌ను తదుపరి processకు పంపకూడదు.</p>
        </Section>

        <Section n="12" title="Confidentiality">
          <p>Company orders, customer details, school details, prices, supplier information, production data, salary information, designs, patterns, measurements మరియు business information confidentialగా ఉంచాలి. సంస్థ అనుమతి లేకుండా బయటివారికి ఇవ్వడం లేదా social mediaలో ప్రచురించడం నిషేధం.</p>
        </Section>

        <Section n="13" title="ప్రవర్తన మరియు క్రమశిక్షణ">
          <p>ఉద్యోగి ఇతర ఉద్యోగులు, supervisors, managers మరియు customersతో గౌరవంగా ప్రవర్తించాలి. గొడవలు, దుర్భాషలు, బెదిరింపులు, దొంగతనం, మద్యం ప్రభావంలో పని, ఉద్దేశపూర్వక production నిలిపివేత, company property damage వంటివి తీవ్రమైన misconductగా పరిగణించబడతాయి.</p>
        </Section>

        <Section n="14" title="ఇతర ఉద్యోగులతో సమన్వయం">
          <p>Production ఒక team-based process కావున ఉద్యోగి తన team members మరియు supervisorsతో సహకరించాలి. వ్యక్తిగత విభేదాల కారణంగా productionకు అంతరాయం కలిగించడం అనుమతించబడదు.</p>
        </Section>

        <Section n="15" title="సెలవు మరియు Weekly Off">
          <p>Weekly off, earned leave, casual leave, sick leave మరియు ఇతర సెలవులు సంస్థ policy మరియు వర్తించే చట్టాల ప్రకారం ఉంటాయి. అత్యవసర పరిస్థితుల్లో supervisor / managerకు వీలైనంత త్వరగా సమాచారం ఇవ్వాలి.</p>
        </Section>

        <Section n="16" title="Resignation / Notice Period">
          <p>ఉద్యోగి రాజీనామా చేయాలనుకుంటే సాధారణంగా {letter.notice_period_days} రోజుల ముందస్తు లిఖితపూర్వక నోటీసు ఇవ్వాలి, లేదా సంస్థ policy / వర్తించే చట్టం ప్రకారం వర్తించే notice లేదా wages in lieu వర్తిస్తుంది.</p>
        </Section>

        <Section n="17" title="Termination / ఉద్యోగం ముగింపు">
          <p>నిరంతర poor performance, తీవ్రమైన misconduct, company property theft/damage, fraud, repeated unauthorized absence, safety violation, confidentiality breach వంటి పరిస్థితుల్లో సంస్థ వర్తించే policy మరియు చట్టపరమైన విధానాన్ని అనుసరించి ఉద్యోగాన్ని ముగించవచ్చు.</p>
        </Section>

        <Section n="18" title="False Information">
          <p>ఉద్యోగి విద్య, అనుభవం, గుర్తింపు, వయస్సు, చిరునామా లేదా ఇతర ముఖ్యమైన వివరాల విషయంలో తప్పుడు సమాచారం అందించినట్లు నిర్ధారణ అయితే సంస్థ తగిన disciplinary action తీసుకోవచ్చు.</p>
        </Section>

        <Section n="19" title="Transfer / Department Change">
          <p>Production అవసరాల మేరకు ఉద్యోగిని సంస్థలోని ఇతర విభాగానికి మార్చే హక్కు మేనేజ్‌మెంట్‌కు ఉంటుంది, ఇది ఉద్యోగి skill మరియు applicable rulesకు లోబడి ఉంటుంది.</p>
        </Section>

        <Section n="20" title="Statutory Benefits">
          <p>ఉద్యోగికి వర్తించే PF, ESI, gratuity, bonus మరియు ఇతర statutory benefits సంబంధిత చట్టాలు మరియు eligibility ప్రకారం అందించబడతాయి.</p>
        </Section>

        <Section n="21" title="ఉద్యోగి అంగీకారం">
          <p>ఈ Offer-cum-Appointment Letterలోని నిబంధనలు నేను చదివి, అర్థం చేసుకుని, అంగీకరిస్తున్నాను. సంస్థ యొక్క పని, safety, attendance, quality, discipline మరియు asset-use policiesను పాటిస్తానని అంగీకరిస్తున్నాను.</p>
        </Section>

        <div className="grid grid-cols-2 gap-8 mt-8 text-sm">
          <div>
            <p className="mb-8">ఉద్యోగి పేరు: {employeeName}</p>
            <p className="border-t border-stone-400 pt-1">సంతకం / తేదీ</p>
          </div>
          <div>
            <p className="font-bold mb-1">సంస్థ తరఫున — T&amp;P TEXTILES</p>
            <p className="mb-6">అధికారిక సంతకం / Company Seal</p>
            <p className="border-t border-stone-400 pt-1">పేరు / పదవి / తేదీ</p>
          </div>
        </div>

        <div className="mt-8 pt-4 border-t-2 border-stone-800 text-sm">
          <h3 className="font-bold text-center mb-3">Annexure – Employee Salary Details</h3>
          <p>Employee Name: {employeeName}</p>
          <p>Designation: {letter.designation}</p>
          <p>Joining Date: {letter.joining_date}</p>
          <p>Monthly Gross Salary: {fmtMoney(gross)}</p>
          <p>Annual Gross Salary: {fmtMoney(gross * 12)}</p>
          <p>PF: {Number(letter.other_deductions) > 0 ? "Applicable" : "Not Applicable"} &nbsp; ESI: {Number(letter.other_deductions) > 0 ? "Applicable" : "Not Applicable"}</p>
          <p>Working Shift: 9:00 AM – 6:00 PM &nbsp; Weekly Off: {letter.weekly_off}</p>
          <p>Probation Period: {letter.probation_months} Months &nbsp; Notice Period: {letter.notice_period_days} Days</p>
        </div>
      </div>
    </div>
  );
}

function Section({ n, title, children }) {
  return (
    <div className="mb-3">
      <p className="font-bold mb-1">{n}. {title}</p>
      <div className="space-y-1 pl-1">{children}</div>
    </div>
  );
}

function Row({ label, value, bold }) {
  return (
    <tr className={bold ? "bg-stone-50 font-semibold" : ""}>
      <td className="border border-stone-400 px-2 py-1">{label}</td>
      <td className="border border-stone-400 px-2 py-1 text-right">{value}</td>
    </tr>
  );
}
