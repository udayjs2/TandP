import { useState } from "react";
import PrintSheet, { PrintFrame } from "./PrintSheet";
import { X, FileText } from "lucide-react";
import { supabase } from "../supabaseClient";
import { Modal, Field, inputCls, Btn } from "./ui";
import { todayStr, fmtMoney } from "../lib/helpers";
import { LETTER_TYPES, DUTIES, guessLetterType } from "../lib/offerLetterContent";

export function OfferLetterModal({ employee, onClose }) {
  const [f, setF] = useState({
    letter_number: "",
    issue_date: todayStr(),
    father_husband_name: "",
    address: "",
    designation: employee.role || "",
    letter_type: guessLetterType(employee.role || ""),
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
  const [typeTouched, setTypeTouched] = useState(false); // once the user picks a type by hand, stop auto-guessing from the designation

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
            <input
              className={inputCls}
              placeholder="e.g. Production Manager, Accountant, Operator"
              value={f.designation}
              onChange={(e) => setF({ ...f, designation: e.target.value, letter_type: typeTouched ? f.letter_type : guessLetterType(e.target.value) })}
            />
          </Field>
          <Field label="Department">
            <input className={inputCls} value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })} />
          </Field>
        </div>
        <Field label="Offer letter type (decides the duties in the Telugu letter)">
          <select className={inputCls} value={f.letter_type} onChange={(e) => { setTypeTouched(true); setF({ ...f, letter_type: e.target.value }); }}>
            {LETTER_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </Field>
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
            <Field label="Other deductions (₹) — PF / ESI start next year">
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

export function PrintOfferLetter({ letter, employeeName, onClose }) {
  const gross = Number(letter.basic_salary) + Number(letter.da_allowance) + Number(letter.attendance_allowance);
  const net = gross - Number(letter.other_deductions);
  const empTypeTelugu = { Regular: "రెగ్యులర్", Probation: "ప్రొబేషన్", Contract: "కాంట్రాక్ట్" }[letter.employment_type] || letter.employment_type;
  const type = LETTER_TYPES.some((t) => t.id === letter.letter_type) ? letter.letter_type : "staff";
  const isStaff = type === "staff";
  const duties = DUTIES[type];
  const typeInfo = LETTER_TYPES.find((t) => t.id === type);

  const salaryBlock = (
    <>
      <p className="mb-2">మీ నెలవారీ వేతనం క్రింది విధంగా ఉంటుంది: మొత్తం నెలవారీ జీతం: ₹{fmtMoney(gross).replace("₹", "")}</p>
      <table className="w-full border border-stone-400 border-collapse mb-2">
        <tbody>
          <Row label="ప్రాథమిక వేతనం (Basic)" value={fmtMoney(letter.basic_salary)} />
          <Row label="DA / ఇతర Allowance" value={fmtMoney(letter.da_allowance)} />
          <Row label="హాజరు / ఇతర Allowance" value={fmtMoney(letter.attendance_allowance)} />
          <Row label="మొత్తం Gross Salary" value={fmtMoney(gross)} bold />
          <Row label="ఇతర మినహాయింపులు (PF / ESI ప్రారంభమయ్యే వరకు వర్తించవు)" value={fmtMoney(letter.other_deductions)} />
          <Row label="చేతికి వచ్చే జీతం (Net Salary)" value={fmtMoney(net)} bold />
        </tbody>
      </table>
      <p>జీతం సంస్థ యొక్క పేరోల్ విధానం ప్రకారం ప్రతి నెల చెల్లించబడుతుంది. PF మరియు ESI వచ్చే సంవత్సరం నుండి ప్రారంభమవుతాయి (తేదీ ఖరారైన తర్వాత తెలియజేయబడుతుంది). వర్తిస్తే Professional Tax, TDS మరియు ఇతర చట్టబద్ధమైన మినహాయింపులు వర్తించవచ్చు.</p>
    </>
  );

  // Clauses that every role gets
  const incrementP = <p>ఉద్యోగి పనితీరు ఆధారంగా జీతం పెంపు (Increment) సంవత్సరానికి ఒకసారి ఇవ్వబడుతుంది. పెంపు మొత్తం మరియు తేదీని ఉద్యోగి పనితీరు, హాజరు, ప్రవర్తన మరియు సంస్థ పరిస్థితులను బట్టి యజమాని నిర్ణయిస్తారు.</p>;
  const noticeP = (
    <>
      <p>ఉద్యోగి రాజీనామా చేయాలనుకుంటే సాధారణంగా {letter.notice_period_days} రోజుల ముందస్తు లిఖితపూర్వక నోటీసు ఇవ్వాలి, లేదా సంస్థ policy / వర్తించే చట్టం ప్రకారం వర్తించే notice లేదా wages in lieu వర్తిస్తుంది.</p>
      <p>ఉద్యోగి నోటీసు కాలం పూర్తి చేయకుండా ఉద్యోగాన్ని మానివేసినా / విడిచిపెట్టినా, తుది జీతం (final settlement) — సంస్థకు చెల్లించాల్సిన ఏవైనా బకాయిలు (ఉదా: advance / loan, తిరిగి ఇవ్వని కంపెనీ ఆస్తులు, పూర్తి చేయని నోటీసు కాలానికి wages in lieu) వర్తించే చట్టం అనుమతించిన మేరకు మినహాయించిన తర్వాత నిర్ణయించి, చెల్లించబడుతుంది.</p>
    </>
  );

  const staffSections = [
    { title: "ఉద్యోగ బాధ్యతలు", body: (<>
      <p>మీకు అప్పగించిన పని మీ పదవికి అనుగుణంగా సమయానికి మరియు నాణ్యతా ప్రమాణాలకు అనుగుణంగా పూర్తి చేయాలి.</p>
      <p>గార్మెంట్ తయారీ యూనిట్‌లో అవసరాన్ని బట్టి Cutting, Stitching, Checking, Finishing, Ironing, Packing, Printing మరియు ఇతర సంబంధిత పనుల్లో పని చేయవలసి ఉంటుంది.</p>
      <p>మేనేజ్‌మెంట్ ఇచ్చే చట్టబద్ధమైన పని సంబంధిత సూచనలను ఉద్యోగి తప్పనిసరిగా పాటించాలి.</p></>) },
    { title: "జీతం / వేతనం", body: salaryBlock },
    { title: "ప్రొబేషన్", body: (<>
      <p>ఉద్యోగి మొదటి {letter.probation_months} నెలలు ప్రొబేషన్ కాలంలో ఉంటారు.</p>
      <p>ఈ కాలంలో ఉద్యోగి యొక్క పని నాణ్యత, హాజరు, ప్రవర్తన, క్రమశిక్షణ, ఉత్పాదకత మరియు బాధ్యతలను పరిశీలిస్తారు.</p>
      <p>పని సంతృప్తికరంగా ఉంటే ఉద్యోగాన్ని కొనసాగించడం / నిర్ధారించడం గురించి సంస్థ నిర్ణయం తీసుకుంటుంది.</p></>) },
    { title: "పని సమయం / Shift Timings", body: shiftBody() },
    { title: "హాజరు మరియు సెలవులు", body: attendanceBody(letter) },
    { title: "ఉత్పత్తి మరియు పని సామర్థ్యం", body: (<>
      <p>గార్మెంట్ పరిశ్రమలో ప్రతి విభాగానికి నిర్ణయించబడిన ఉత్పత్తి లక్ష్యాలు ఉంటాయి. ఉద్యోగి తనకు కేటాయించిన పనిని నిర్ణయించిన సమయానికి, నిర్దేశించిన పరిమాణంలో, సరైన నాణ్యతతో, తక్కువ రీవర్క్ / రిజెక్షన్‌తో పూర్తి చేయడానికి బాధ్యత వహించాలి.</p>
      <p>ఉత్పత్తి లక్ష్యాలు ఆర్డర్, garment type, operation difficulty, machine మరియు పని పరిస్థితులను బట్టి మేనేజ్‌మెంట్ నిర్ణయిస్తుంది.</p></>) },
    { title: "Sewing Machine / Factory Equipment వినియోగం", body: (<>
      <p>ఉద్యోగికి కేటాయించిన sewing machine లేదా ఇతర యంత్రాలను జాగ్రత్తగా ఉపయోగించాలి. Machine‌ను అనుమతి లేకుండా ఇతరులకు ఇవ్వకూడదు, వ్యక్తిగత పనులకు ఉపయోగించకూడదు, ఉద్దేశపూర్వకంగా damage చేయకూడదు, Safety guards తొలగించి ఉపయోగించకూడదు.</p>
      <p>Machineలో abnormal sound / problem కనిపిస్తే వెంటనే Supervisor / Mechanicకు తెలియజేయాలి. ఉద్దేశపూర్వక నిర్లక్ష్యం లేదా దుర్వినియోగం వల్ల జరిగిన నష్టంపై సంస్థ తన disciplinary policy మరియు వర్తించే చట్టాల ప్రకారం చర్య తీసుకోవచ్చు.</p></>) },
    { title: "Buttons, Zips, Labels మరియు ఇతర Accessories", body: (<>
      <p>Buttons, zips, labels, elastic, thread, tags, packing materials మరియు ఇతర production accessories సంస్థకు చెందినవి. ఉద్యోగి అవసరమైన పరిమాణంలో మాత్రమే material తీసుకోవాలి, వృథా కాకుండా జాగ్రత్తగా ఉపయోగించాలి, మిగిలిన material‌ను తిరిగి ఇవ్వాలి.</p>
      <p>Material‌ను ఇంటికి తీసుకెళ్లడం లేదా వ్యక్తిగతంగా ఉపయోగించడం నిషేధం. ఉద్దేశపూర్వకంగా దుర్వినియోగం జరిగితే సంస్థ disciplinary procedure ప్రకారం చర్య తీసుకోవచ్చు.</p></>) },
    { title: "Company Property", body: companyProperty() },
    { title: "Safety Rules", body: (<p>Factoryలో safety rules తప్పనిసరిగా పాటించాలి — Machine safety, electrical safety, fire safety, needle safety మరియు ఇతర procedures. అందించిన PPE సరైన విధంగా ఉపయోగించాలి. వివరణాత్మక Safety Rules ఈ లేఖకు జతచేసిన <b>Annexure B – Safety Rules</b> పేజీలో ఉన్నాయి; ఉద్యోగి ఆ పేజీని చదివి సంతకం చేయాలి. ఉద్దేశపూర్వకంగా ఉల్లంఘించడం disciplinary actionకు కారణం కావచ్చు.</p>) },
    { title: "నాణ్యత (Quality)", body: (<p>ప్రతి garment సంస్థ నిర్దేశించిన quality standards ప్రకారం తయారు చేయాలి. Needle damage, open seam, loose thread, wrong measurement, wrong label, wrong size, stain, printing defect లేదా ఇతర defects కనిపిస్తే వెంటనే Supervisor / Quality Departmentకు తెలియజేయాలి. నాణ్యతను దాచిపెట్టి defective garments‌ను తదుపరి processకు పంపకూడదు.</p>) },
    { title: "Confidentiality", body: confidentiality(true) },
    { title: "ప్రవర్తన మరియు క్రమశిక్షణ", body: (<p>ఉద్యోగి ఇతర ఉద్యోగులు, supervisors, managers మరియు customersతో గౌరవంగా ప్రవర్తించాలి. గొడవలు, దుర్భాషలు, బెదిరింపులు, మద్యం ప్రభావంలో పని, ఉద్దేశపూర్వక production నిలిపివేత, company property damage వంటివి తీవ్రమైన misconductగా పరిగణించబడతాయి.</p>) },
    { title: "ఇతర ఉద్యోగులతో సమన్వయం", body: (<p>Production ఒక team-based process కావున ఉద్యోగి తన team members మరియు supervisorsతో సహకరించాలి. వ్యక్తిగత విభేదాల కారణంగా productionకు అంతరాయం కలిగించడం అనుమతించబడదు.</p>) },
    { title: "వార్షిక జీతం పెంపు (Increment)", body: incrementP },
    { title: "Resignation / Notice Period", body: noticeP },
    { title: "Termination / ఉద్యోగం ముగింపు", body: (<p>నిరంతర poor performance, తీవ్రమైన misconduct, company property damage, fraud, repeated unauthorized absence, safety violation, confidentiality breach వంటి పరిస్థితుల్లో సంస్థ వర్తించే policy మరియు చట్టపరమైన విధానాన్ని అనుసరించి ఉద్యోగాన్ని ముగించవచ్చు.</p>) },
    { title: "False Information", body: falseInfo() },
    { title: "Transfer / Department Change", body: (<p>Production అవసరాల మేరకు ఉద్యోగిని సంస్థలోని ఇతర విభాగానికి మార్చే హక్కు మేనేజ్‌మెంట్‌కు ఉంటుంది, ఇది ఉద్యోగి skill మరియు applicable rulesకు లోబడి ఉంటుంది.</p>) },
    { title: "Statutory Benefits", body: statutory() },
    { title: "ఉద్యోగి అంగీకారం", body: acceptance() },
  ];

  // Managers / office roles: duties first, then the general terms (no theft wording in any letter)
  const termSections = [
    { title: "జీతం / వేతనం", body: salaryBlock },
    { title: "ప్రొబేషన్", body: (<>
      <p>ఉద్యోగి మొదటి {letter.probation_months} నెలలు ప్రొబేషన్ కాలంలో ఉంటారు. ఈ కాలంలో పని నాణ్యత, హాజరు, ప్రవర్తన, బాధ్యతాయుతమైన పని విధానం మరియు ఫలితాలను పరిశీలిస్తారు.</p>
      <p>పని సంతృప్తికరంగా ఉంటే ఉద్యోగాన్ని కొనసాగించడం / నిర్ధారించడం గురించి సంస్థ నిర్ణయం తీసుకుంటుంది.</p></>) },
    { title: "పని సమయం / Shift Timings", body: shiftBody() },
    { title: "హాజరు మరియు సెలవులు", body: attendanceBody(letter) },
    { title: "వార్షిక జీతం పెంపు (Increment)", body: incrementP },
    { title: "Company Property", body: companyProperty() },
    { title: "Confidentiality", body: confidentiality(false) },
    { title: "ప్రవర్తన మరియు క్రమశిక్షణ", body: (<p>ఉద్యోగి ఇతర ఉద్యోగులు, సిబ్బంది, కస్టమర్లు మరియు సరఫరాదారులతో గౌరవంగా ప్రవర్తించాలి. సంస్థ విధానాలను పాటించాలి. గొడవలు, దుర్భాషలు, బెదిరింపులు, అధికార దుర్వినియోగం, మద్యం ప్రభావంలో పని, company property damage వంటివి తీవ్రమైన misconductగా పరిగణించబడతాయి.</p>) },
    { title: "Resignation / Notice Period", body: noticeP },
    { title: "Termination / ఉద్యోగం ముగింపు", body: (<p>నిరంతర poor performance, తీవ్రమైన misconduct, fraud, అధికార దుర్వినియోగం, repeated unauthorized absence, confidentiality breach వంటి పరిస్థితుల్లో సంస్థ వర్తించే policy మరియు చట్టపరమైన విధానాన్ని అనుసరించి ఉద్యోగాన్ని ముగించవచ్చు.</p>) },
    { title: "False Information", body: falseInfo() },
    { title: "Transfer / బాధ్యతల మార్పు", body: (<p>సంస్థ అవసరాల మేరకు ఉద్యోగి బాధ్యతలు లేదా విభాగాన్ని మార్చే హక్కు యజమానికి ఉంటుంది; ఇది ఉద్యోగి హోదా, నైపుణ్యం మరియు వర్తించే నిబంధనలకు లోబడి ఉంటుంది.</p>) },
    { title: "Statutory Benefits", body: statutory() },
    { title: "ఉద్యోగి అంగీకారం", body: acceptance() },
  ];

  return (
    <PrintSheet>
      <div className="no-print sticky top-0 flex justify-end gap-2 bg-stone-100 border-b border-stone-200 p-2">
        <Btn variant="ghost" onClick={onClose}><X size={14} /> Close</Btn>
        <Btn onClick={() => window.print()}><FileText size={14} /> Print</Btn>
      </div>

      <div id="print-offer" className="print-page max-w-2xl mx-auto p-8 text-[13px] leading-relaxed">
        <PrintFrame header={(
        <div className="text-center border-b-2 border-stone-800 pb-3 mb-4 bg-white">
          <img src="/logo-mark-navy.png" alt="" className="h-12 mx-auto mb-1" style={{ height: 48, width: "auto" }} />
          <h1 className="text-xl font-extrabold">T&P TEXTILES</h1>
          <p className="text-sm text-stone-600">GARMENTS MANUFACTURING UNIT</p>
        </div>
        )}>

        <h2 className="text-center text-lg font-bold mb-1">ఉద్యోగ నియామక / ఆఫర్ లెటర్</h2>
        {!isStaff && <p className="text-center font-semibold mb-4">{typeInfo.te}</p>}
        {isStaff && <div className="mb-3" />}

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

        {isStaff ? (
          staffSections.map((sec, i) => <Section key={i} n={i + 1} title={sec.title}>{sec.body}</Section>)
        ) : (
          <>
            <h3 className="font-bold text-sm mt-2 mb-2 border-b border-stone-300 pb-1">భాగం A — ఉద్యోగ బాధ్యతలు మరియు విధులు (Roles &amp; Responsibilities)</h3>
            {duties.sections.map((d, i) => (
              <div key={i} className="mb-3">
                <p className="font-bold mb-1">{i + 1}. {d.h}</p>
                <ul className="list-disc pl-6 space-y-0.5">{d.items.map((it, k) => <li key={k}>{it}</li>)}</ul>
              </div>
            ))}
            <p className="mb-4 italic">{duties.closing}</p>
            <h3 className="font-bold text-sm mt-4 mb-2 border-b border-stone-300 pb-1">భాగం B — నిబంధనలు మరియు షరతులు (Terms &amp; Conditions)</h3>
            {termSections.map((sec, i) => <Section key={i} n={i + 1} title={sec.title}>{sec.body}</Section>)}
          </>
        )}

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
          <h3 className="font-bold text-center mb-3">Annexure A – Employee Salary Details</h3>
          <p>Employee Name: {employeeName}</p>
          <p>Designation: {letter.designation}</p>
          <p>Joining Date: {letter.joining_date}</p>
          <p>Monthly Gross Salary: {fmtMoney(gross)}</p>
          <p>Annual Gross Salary: {fmtMoney(gross * 12)}</p>
          <p>PF: Not applicable at present &nbsp; ESI: Not applicable at present — both start from next year (date to be communicated once finalised)</p>
          <p>Working Shift: 9:00 AM – 6:00 PM &nbsp; Weekly Off: {letter.weekly_off}</p>
          <p>Probation Period: {letter.probation_months} Months &nbsp; Notice Period: {letter.notice_period_days} Days</p>
          <p>Increment: Performance based, once a year</p>
        </div>

        <div className="mt-10 pt-4 text-sm" style={{ breakBefore: "page", pageBreakBefore: "always" }} data-testid="safety-annexure">
          <h3 className="font-bold text-center text-base mb-1">Annexure B – Safety Rules (భద్రతా నియమాలు)</h3>
          <p className="text-center text-stone-600 mb-4">T&amp;P TEXTILES — ఉద్యోగి: {employeeName}</p>
          <ol className="list-decimal pl-6 space-y-2">
            {SAFETY_RULES.map((r, i) => <li key={i}><b>{r.h}:</b> {r.t}</li>)}
          </ol>
          <p className="mt-4">పై Safety Rules అన్నీ నేను చదివాను, అర్థం చేసుకున్నాను మరియు తప్పనిసరిగా పాటిస్తానని అంగీకరిస్తున్నాను. ఉద్దేశపూర్వక ఉల్లంఘన disciplinary actionకు కారణం కావచ్చని నాకు తెలుసు.</p>
          <div className="grid grid-cols-2 gap-8 mt-10">
            <div>
              <p className="mb-8">ఉద్యోగి పేరు: {employeeName}</p>
              <p className="border-t border-stone-400 pt-1">ఉద్యోగి సంతకం / తేదీ</p>
            </div>
            <div>
              <p className="mb-8">సంస్థ తరఫున — T&amp;P TEXTILES</p>
              <p className="border-t border-stone-400 pt-1">అధికారిక సంతకం / తేదీ</p>
            </div>
          </div>
        </div>
        </PrintFrame>
      </div>
    </PrintSheet>
  );
}

const SAFETY_RULES = [
  { h: "Machine safety", t: "Threading, needle మార్చడం, శుభ్రం చేయడం, మరమ్మతు వంటి పనులు machine పూర్తిగా ఆగిన తర్వాత (switch off) మాత్రమే చేయాలి. Needle guard, belt cover, eye guard వంటి safety guardsను తొలగించకూడదు. Machineలో abnormal sound / problem ఉంటే వెంటనే Supervisor / Mechanicకు తెలియజేయాలి." },
  { h: "Electrical safety", t: "తడి చేతులతో switch, plug, machine ముట్టుకోకూడదు. తెగిన wires, damaged sockets కనిపిస్తే వెంటనే తెలియజేయాలి. అధికారం లేకుండా electrical మరమ్మతులు చేయకూడదు. పని ముగిశాక machines, iron, lights switch off చేయాలి." },
  { h: "Fire safety", t: "Factory లోపల smoking మరియు open flame నిషేధం. Fire exits, extinguishers, electrical panels దగ్గర ఎటువంటి అడ్డంకులు పెట్టకూడదు. Iron / heaters గమనించకుండా వదిలివేయకూడదు. అగ్ని / పొగ గమనిస్తే వెంటనే అందరికీ తెలియజేసి, ఇచ్చిన సూచనల ప్రకారం సురక్షితంగా బయటకు వెళ్లాలి." },
  { h: "Needle safety", t: "విరిగిన needle ముక్కలన్నీ సేకరించి Supervisorకు అప్పగించాలి; పాత / విరిగిన needle ఇచ్చి మాత్రమే కొత్త needle తీసుకోవాలి. Needleను garment లో, fabric లో లేదా నేలపై వదిలివేయకూడదు." },
  { h: "Cutting tools", t: "Scissors, cutting machine, blades జాగ్రత్తగా ఉపయోగించాలి; పని ముగిశాక నిర్ణీత స్థలంలో ఉంచాలి. Cutting machine guard తొలగించకూడదు; అవసరమైన gloves ధరించాలి." },
  { h: "PPE (వ్యక్తిగత రక్షణ పరికరాలు)", t: "సంస్థ అందించిన mask, gloves, apron, ear protection వంటి PPEని సరైన విధంగా ధరించి ఉపయోగించాలి. వాటిని ఇతరులకు ఇవ్వకూడదు; పాడైతే వెంటనే తెలియజేసి మార్చుకోవాలి." },
  { h: "Housekeeping", t: "నడిచే మార్గాలు, exits ఎల్లప్పుడూ ఖాళీగా ఉంచాలి. నేలపై thread, fabric waste, నూనె లేదా నీరు ఉంచకూడదు. Chemicals / printing materialను నిర్ణీత స్థలంలో, label తో భద్రంగా ఉంచాలి." },
  { h: "ప్రమాదాలు / గాయాలు", t: "ఏ చిన్న గాయం, ప్రమాదం లేదా near-miss జరిగినా వెంటనే Supervisorకు తెలియజేయాలి. First aid తీసుకోవాలి; ప్రమాదాన్ని దాచిపెట్టకూడదు." },
  { h: "ఆరోగ్యం మరియు జాగ్రత్త", t: "మద్యం / మత్తు ప్రభావంలో లేదా ఆరోగ్యం బాగాలేనప్పుడు machine ఆపరేట్ చేయకూడదు. పని సమయంలో అజాగ్రత్తగా పరుగెత్తడం, ఆటలు ఆడటం నిషేధం." },
  { h: "ఉల్లంఘన", t: "Safety rules ఉద్దేశపూర్వకంగా ఉల్లంఘించడం సంస్థ disciplinary policy ప్రకారం చర్యకు కారణం కావచ్చు." },
];

// ---- shared Telugu paragraphs ----
function shiftBody() {
  return (
    <>
      <p>సాధారణ పని సమయం: ఉదయం 9:00 గంటల నుండి సాయంత్రం 6:00 గంటల వరకు. భోజన విరామం: 1 గంట.</p>
      <p>పని అవసరాన్ని బట్టి మేనేజ్‌మెంట్ షిఫ్ట్ సమయాలను మార్చవచ్చు లేదా అదనపు షిఫ్ట్ ఏర్పాటు చేయవచ్చు.</p>
      <p>షిఫ్ట్ మార్పు, వారపు సెలవు మరియు పని సమయాలు సంస్థ అవసరాలు మరియు వర్తించే కార్మిక చట్టాలకు అనుగుణంగా నిర్వహించబడతాయి.</p>
      <p>అనుమతి లేకుండా షిఫ్ట్ ప్రారంభ సమయానికి ఆలస్యంగా రావడం లేదా పని మధ్యలో వెళ్లిపోవడం హాజరు / క్రమశిక్షణ సమస్యగా పరిగణించబడుతుంది.</p>
    </>
  );
}
function attendanceBody(letter) {
  return (
    <>
      <p>ఉద్యోగి ప్రతిరోజూ సమయానికి హాజరు కావాలి. సెలవు అవసరమైతే సాధ్యమైనంత ముందుగా Supervisor / Manager నుండి అనుమతి తీసుకోవాలి.</p>
      <p><b>వరుస గైర్హాజరు (Continuous absence):</b> అనుమతి లేకుండా లేదా సమాచారం ఇవ్వకుండా వరుసగా 3 పని దినాలు (వారపు సెలవు మరియు ప్రభుత్వ సెలవులు మినహా) గైర్హాజరు కావడాన్ని "వరుస గైర్హాజరు"గా పరిగణిస్తారు.</p>
      <p><b>నోటీసు విధానం:</b> అటువంటి సందర్భంలో సంస్థ ఉద్యోగి ఇచ్చిన ఫోన్ నంబర్ / WhatsApp / చిరునామాకు లిఖితపూర్వక నోటీసు పంపుతుంది. ఆ నోటీసు పంపిన తేదీ నుండి 7 రోజులలోపు ఉద్యోగి విధులకు హాజరై, గైర్హాజరుకు కారణాన్ని లిఖితపూర్వకంగా తెలియజేయాలి.</p>
      <p>ఈ గడువులోపు విధులకు హాజరు కాకపోయినా, లేదా సరైన కారణం (ఉదా: వైద్య ధృవీకరణ పత్రంతో అనారోగ్యం) చూపకపోయినా, ఉద్యోగి ఉద్యోగాన్ని వదిలివేసినట్లు (abandonment) సంస్థ పరిగణించవచ్చు; వర్తించే చట్టం మరియు సంస్థ విధానం ప్రకారం తగిన చర్య (ఉద్యోగం ముగింపుతో సహా) తీసుకోవచ్చు. అనారోగ్యం / అత్యవసర పరిస్థితుల్లో ఉద్యోగి సాధ్యమైనంత త్వరగా (ఫోన్ / మెసేజ్ ద్వారా) Supervisorకు తెలియజేయాలి.</p>
      <p>వారపు సెలవులు, earned leave, casual leave, sick leave మరియు చట్టబద్ధమైన సెలవులు సంస్థ Leave Policy మరియు వర్తించే చట్టాల ప్రకారం ఉంటాయి. వారపు సెలవు: {letter.weekly_off}.</p>
    </>
  );
}
function companyProperty() {
  return <p>Machine, scissors, cutting tools, measuring tools, iron, computer, ID card, uniform, documents, samples, fabric, accessories, files మరియు ఇతర కంపెనీ ఆస్తులు సంస్థకు చెందినవి. ఉద్యోగం ముగిసినప్పుడు లేదా సంస్థ కోరినప్పుడు అన్ని కంపెనీ ఆస్తులను తిరిగి అప్పగించాలి.</p>;
}
function confidentiality(staff) {
  return staff
    ? <>
        <p>Company orders, customer details, school details, prices, supplier information, production data, designs, patterns, measurements మరియు business information confidentialగా ఉంచాలి. ఇతర ఉద్యోగుల జీతం మరియు వారి వ్యక్తిగత వివరాలను బయటివారికి లేదా ఇతర ఉద్యోగులకు తెలియజేయకూడదు. సంస్థ అనుమతి లేకుండా బయటివారికి ఇవ్వడం లేదా social mediaలో ప్రచురించడం నిషేధం.</p>
        <p>ఉద్యోగి తన స్వంత జీతం మరియు ఉద్యోగ వివరాలను labour inspector లేదా ఇతర చట్టబద్ధ అధికారులకు తెలియజేయడానికి ఈ నిబంధన ఎటువంటి అడ్డంకి కాదు.</p>
      </>
    : <>
        <p>Company orders, customer details, school details, prices, supplier information, production data, ఆర్థిక వివరాలు, ఇతర ఉద్యోగుల జీతం మరియు వ్యక్తిగత వివరాలు, designs మరియు business information confidentialగా ఉంచాలి. సంస్థ అనుమతి లేకుండా బయటివారికి ఇవ్వడం లేదా social mediaలో ప్రచురించడం నిషేధం. ఈ నిబంధన ఉద్యోగం ముగిసిన తర్వాత కూడా వర్తిస్తుంది.</p>
        <p>ఉద్యోగి తన స్వంత జీతం మరియు ఉద్యోగ వివరాలను labour inspector లేదా ఇతర చట్టబద్ధ అధికారులకు తెలియజేయడానికి ఈ నిబంధన ఎటువంటి అడ్డంకి కాదు.</p>
      </>;
}
function falseInfo() {
  return <p>ఉద్యోగి విద్య, అనుభవం, గుర్తింపు, వయస్సు, చిరునామా లేదా ఇతర ముఖ్యమైన వివరాల విషయంలో తప్పుడు సమాచారం అందించినట్లు నిర్ధారణ అయితే సంస్థ తగిన disciplinary action తీసుకోవచ్చు.</p>;
}
function statutory() {
  return <>
    <p>PF మరియు ESI వచ్చే సంవత్సరం నుండి అమలులోకి వస్తాయి. ప్రారంభ తేదీ ఖరారు అయిన తర్వాత ఉద్యోగులకు తెలియజేయబడుతుంది; అప్పటివరకు ఈ మినహాయింపులు వర్తించవు.</p>
    <p>Gratuity, bonus మరియు ఇతర statutory benefits సంబంధిత చట్టాలు మరియు eligibility ప్రకారం అందించబడతాయి.</p></>;
}
function acceptance() {
  return <p>ఈ Offer-cum-Appointment Letterలోని నిబంధనలు నేను చదివి, అర్థం చేసుకుని, అంగీకరిస్తున్నాను. సంస్థ యొక్క పని, safety, attendance, quality, discipline మరియు asset-use policiesను పాటిస్తానని అంగీకరిస్తున్నాను. జతచేసిన <b>Annexure A (జీతం వివరాలు)</b> మరియు <b>Annexure B (Safety Rules)</b>లను చదివి, అర్థం చేసుకుని, పాటిస్తానని అంగీకరిస్తున్నాను.</p>;
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
