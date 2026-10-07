import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { ArcaWsaaService } from './arca-wsaa.service';
import {
  child,
  children,
  escapeXml,
  soapRequest,
  type XmlNode,
} from './arca-soap';
import {
  validFiscalDate,
  type ArcaCreditNoteRequest,
  type ArcaVoucherRequest,
} from './fiscal-request';

export type {
  ArcaInvoiceRequest,
  ArcaCreditNoteRequest,
  ArcaVoucherRequest,
} from './fiscal-request';

const NS = 'http://ar.gov.afip.dif.FEV1/';
const uncertain = () =>
  new Error(
    'No se pudo verificar la respuesta de ARCA. Consultá el resultado antes de volver a emitir.',
  );
const tag = (name: string, value: string | number) =>
  `<${name}>${escapeXml(String(value))}</${name}>`;
function value(node: XmlNode, name: string): string {
  const field = child(node, name, NS);
  if (field.children.length) throw uncertain();
  return field.text.trim();
}
function optional(node: XmlNode, name: string): string | null {
  const fields = children(node, name, NS);
  if (!fields.length) return null;
  return value(node, name);
}
function same(node: XmlNode, name: string, expected: string | number) {
  if (value(node, name) !== String(expected)) throw uncertain();
}
function money(node: XmlNode, name: string, expected: string) {
  const actual = value(node, name);
  if (
    !/^\d+(?:\.\d+)?$/.test(actual) ||
    !new Prisma.Decimal(actual).eq(expected)
  )
    throw uncertain();
}
function errors(node: XmlNode): XmlNode[] {
  if (!children(node, 'Errors', NS).length) return [];
  const container = child(node, 'Errors', NS);
  if (
    container.text.trim() ||
    container.children.some(
      (item) => item.name !== 'Err' || item.namespace !== NS,
    )
  )
    throw uncertain();
  return children(container, 'Err', NS);
}
function noErrors(node: XmlNode) {
  if (errors(node).length) throw uncertain();
}
function compatibleClasses(value: string, expected: string): boolean {
  const classes = value.split('/');
  return (
    classes.length > 0 &&
    new Set(classes).size === classes.length &&
    classes.every((c) => ['A', 'B', 'C', 'M', 'ALEY', '49'].includes(c)) &&
    classes.includes(expected)
  );
}
function matchesDetail(node: XmlNode, r: ArcaVoucherRequest) {
  same(node, 'Concepto', 1);
  same(node, 'DocTipo', 80);
  same(node, 'DocNro', r.recipientCuit);
  same(node, 'CbteDesde', r.voucherNumber);
  same(node, 'CbteHasta', r.voucherNumber);
  same(node, 'CbteFch', r.date);
}
function association(
  r: ArcaVoucherRequest,
): ArcaCreditNoteRequest['associated'] | null {
  if ([1, 6, 11].includes(r.voucherType)) {
    if ('associated' in r) throw uncertain();
    return null;
  }
  if (!('associated' in r) || ![3, 8, 13].includes(r.voucherType))
    throw uncertain();
  const a = r.associated;
  if (
    !a ||
    a.voucherType !== ({ 3: 1, 8: 6, 13: 11 } as const)[r.voucherType] ||
    a.issuerCuit !== r.issuerCuit ||
    !/^\d{11}$/.test(a.issuerCuit) ||
    a.pointOfSale !== r.pointOfSale ||
    !Number.isInteger(a.pointOfSale) ||
    a.pointOfSale < 1 ||
    a.pointOfSale > 99999 ||
    !Number.isInteger(a.voucherNumber) ||
    a.voucherNumber < 1 ||
    a.voucherNumber > 99999999 ||
    !validFiscalDate(a.date) ||
    !validFiscalDate(r.date) ||
    a.date > r.date
  )
    throw uncertain();
  return a;
}
function matchesAssociation(node: XmlNode, r: ArcaVoucherRequest) {
  const expected = association(r);
  const containers = children(node, 'CbtesAsoc', NS);
  if (!expected) {
    if (
      containers.length > 1 ||
      containers.some((item) => item.children.length || item.text.trim())
    )
      throw uncertain();
    return;
  }
  const container = child(node, 'CbtesAsoc', NS);
  if (container.text.trim() || container.children.length !== 1)
    throw uncertain();
  const entry = child(container, 'CbteAsoc', NS);
  const fields = ['Tipo', 'PtoVta', 'Nro', 'Cuit', 'CbteFch'];
  if (
    entry.text.trim() ||
    entry.children.length !== fields.length ||
    entry.children.some((item) => !fields.includes(item.name))
  )
    throw uncertain();
  same(entry, 'Tipo', expected.voucherType);
  same(entry, 'PtoVta', expected.pointOfSale);
  same(entry, 'Nro', expected.voucherNumber);
  same(entry, 'Cuit', expected.issuerCuit);
  same(entry, 'CbteFch', expected.date);
}
function authorization(node: XmlNode, caeName: string, dateName: string) {
  const cae = value(node, caeName);
  const expiresAt = value(node, dateName);
  if (!/^\d{14}$/.test(cae) || !validFiscalDate(expiresAt)) throw uncertain();
  return {
    status: 'AUTHORIZED' as const,
    cae,
    expiresAt,
    message: 'Comprobante autorizado en homologación. Sin validez fiscal.',
  };
}
const REJECTION_MESSAGE =
  'ARCA rechazó el comprobante de homologación. Revisá los datos fiscales.';
const REJECTION_HINTS: Readonly<Record<string, string>> = {
  '10048': 'El total no coincide con la suma de sus componentes.',
  '10242': 'Revisá la condición de IVA del receptor en el catálogo de ARCA.',
  '10243':
    'La condición de IVA del receptor no corresponde a la clase del comprobante.',
  '10246': 'Falta informar la condición de IVA del receptor.',
};
const MAX_DIAGNOSTIC_NODES = 100;
const MAX_REJECTION_CODES = 10;
function rejectionMessage(node: XmlNode): string {
  // Diagnostics never determine the result. Only bounded, direct numeric codes
  // are used; upstream Msg text is neither inspected nor returned.
  if (node.children.length > MAX_DIAGNOSTIC_NODES) return REJECTION_MESSAGE;
  let remaining = MAX_DIAGNOSTIC_NODES - node.children.length;
  const containers = children(node, 'Observaciones', NS);
  if (containers.length !== 1 || containers[0].text.trim())
    return REJECTION_MESSAGE;
  const codes = new Set<string>();
  for (const observation of containers[0].children) {
    if (remaining-- <= 0 || codes.size === MAX_REJECTION_CODES) break;
    if (
      observation.name !== 'Obs' ||
      observation.namespace !== NS ||
      observation.text.trim()
    )
      continue;
    let code: XmlNode | undefined;
    let invalid = false;
    for (const field of observation.children) {
      if (remaining-- <= 0) {
        invalid = true;
        break;
      }
      if (field.name !== 'Code' || field.namespace !== NS) continue;
      if (code) {
        invalid = true;
        break;
      }
      code = field;
    }
    if (invalid || !code || code.children.length) continue;
    const text = code.text.trim();
    if (/^[1-9]\d{0,4}$/.test(text)) codes.add(text);
  }
  if (!codes.size) return REJECTION_MESSAGE;
  return `${REJECTION_MESSAGE} ${[...codes]
    .map(
      (code) =>
        `Código ${code}: ${REJECTION_HINTS[code] ?? 'Revisá este código en el manual de ARCA.'}`,
    )
    .join(' ')}`;
}
@Injectable()
export class ArcaWsfeService {
  constructor(private readonly wsaa: ArcaWsaaService) {}
  private async call(
    companyId: string,
    cuit: string,
    method: string,
    payload = '',
  ): Promise<XmlNode> {
    try {
      const ticket = await this.wsaa.getTicket(companyId, cuit);
      const auth = `<Auth>${tag('Token', ticket.token)}${tag('Sign', ticket.sign)}${tag('Cuit', cuit)}</Auth>`;
      const body = await soapRequest(
        'WSFE',
        method,
        `<${method} xmlns="${NS}">${auth}${payload}</${method}>`,
      );
      const result = child(
        child(body, `${method}Response`, NS),
        `${method}Result`,
        NS,
      );
      const assertNamespace = (node: XmlNode) => {
        if (node.namespace !== NS) throw uncertain();
        node.children.forEach(assertNamespace);
      };
      assertNamespace(result);
      return result;
    } catch {
      throw uncertain();
    }
  }
  async validate(
    companyId: string,
    r: Omit<ArcaVoucherRequest, 'voucherNumber'>,
  ): Promise<void> {
    const points = await this.call(
      companyId,
      r.issuerCuit,
      'FEParamGetPtosVenta',
    );
    noErrors(points);
    const point = children(
      child(points, 'ResultGet', NS),
      'PtoVenta',
      NS,
    ).filter((p) => value(p, 'Nro') === String(r.pointOfSale));
    if (
      point.length !== 1 ||
      value(point[0], 'EmisionTipo') !== 'CAE' ||
      value(point[0], 'Bloqueado') !== 'N' ||
      ![null, '', 'NULL'].includes(optional(point[0], 'FchBaja'))
    )
      throw uncertain();
    const invoiceClass = [1, 3].includes(r.voucherType)
      ? 'A'
      : [6, 8].includes(r.voucherType)
        ? 'B'
        : 'C';
    const conditions = await this.call(
      companyId,
      r.issuerCuit,
      'FEParamGetCondicionIvaReceptor',
      tag('ClaseCmp', invoiceClass),
    );
    noErrors(conditions);
    const condition = children(
      child(conditions, 'ResultGet', NS),
      'CondicionIvaReceptor',
      NS,
    ).filter(
      (c) =>
        value(c, 'Id') === String(r.recipientVatConditionId) &&
        compatibleClasses(value(c, 'Cmp_Clase'), invoiceClass),
    );
    if (condition.length !== 1) throw uncertain();
    if (r.iva.length) {
      const rates = await this.call(
        companyId,
        r.issuerCuit,
        'FEParamGetTiposIva',
      );
      noErrors(rates);
      const catalog = children(child(rates, 'ResultGet', NS), 'IvaTipo', NS);
      for (const rate of r.iva) {
        const rows = catalog.filter(
          (row) => value(row, 'Id') === String(rate.id),
        );
        if (rows.length !== 1) throw uncertain();
        const from = value(rows[0], 'FchDesde');
        const until = optional(rows[0], 'FchHasta');
        if (
          !validFiscalDate(from) ||
          from > r.date ||
          (until &&
            until !== 'NULL' &&
            (!validFiscalDate(until) || until < r.date))
        )
          throw uncertain();
      }
    }
  }
  async lastNumber(
    companyId: string,
    cuit: string,
    pv: number,
    type: number,
  ): Promise<number> {
    const result = await this.call(
      companyId,
      cuit,
      'FECompUltimoAutorizado',
      tag('PtoVta', pv) + tag('CbteTipo', type),
    );
    noErrors(result);
    same(result, 'PtoVta', pv);
    same(result, 'CbteTipo', type);
    const text = value(result, 'CbteNro');
    if (!/^\d{1,8}$/.test(text)) throw uncertain();
    return Number(text);
  }
  async authorize(companyId: string, r: ArcaVoucherRequest) {
    const associated = association(r);
    const head = `<FeCabReq>${tag('CantReg', 1)}${tag('PtoVta', r.pointOfSale)}${tag('CbteTipo', r.voucherType)}</FeCabReq>`;
    const detail =
      tag('Concepto', 1) +
      tag('DocTipo', 80) +
      tag('DocNro', r.recipientCuit) +
      tag('CbteDesde', r.voucherNumber) +
      tag('CbteHasta', r.voucherNumber) +
      tag('CbteFch', r.date) +
      tag('ImpTotal', r.total) +
      tag('ImpTotConc', r.notTaxed) +
      tag('ImpNeto', r.net) +
      tag('ImpOpEx', r.exempt) +
      tag('ImpTrib', '0.00') +
      tag('ImpIVA', r.vat) +
      tag('MonId', 'PES') +
      tag('MonCotiz', '1') +
      tag('CondicionIVAReceptorId', r.recipientVatConditionId) +
      (associated
        ? `<CbtesAsoc><CbteAsoc>${tag('Tipo', associated.voucherType)}${tag('PtoVta', associated.pointOfSale)}${tag('Nro', associated.voucherNumber)}${tag('Cuit', associated.issuerCuit)}${tag('CbteFch', associated.date)}</CbteAsoc></CbtesAsoc>`
        : '') +
      (r.iva.length
        ? `<Iva>${r.iva.map((i) => `<AlicIva>${tag('Id', i.id)}${tag('BaseImp', i.base)}${tag('Importe', i.amount)}</AlicIva>`).join('')}</Iva>`
        : '');
    const result = await this.call(
      companyId,
      r.issuerCuit,
      'FECAESolicitar',
      `<FeCAEReq>${head}<FeDetReq><FECAEDetRequest>${detail}</FECAEDetRequest></FeDetReq></FeCAEReq>`,
    );
    noErrors(result);
    const header = child(result, 'FeCabResp', NS);
    same(header, 'Cuit', r.issuerCuit);
    same(header, 'PtoVta', r.pointOfSale);
    same(header, 'CbteTipo', r.voucherType);
    same(header, 'CantReg', 1);
    const rows = children(
      child(result, 'FeDetResp', NS),
      'FECAEDetResponse',
      NS,
    );
    if (rows.length !== 1) throw uncertain();
    matchesDetail(rows[0], r);
    const status = value(rows[0], 'Resultado');
    same(header, 'Resultado', status);
    if (status === 'A') return authorization(rows[0], 'CAE', 'CAEFchVto');
    if (
      status === 'R' &&
      !optional(rows[0], 'CAE') &&
      !optional(rows[0], 'CAEFchVto')
    ) {
      return {
        status: 'REJECTED' as const,
        cae: null,
        expiresAt: null,
        message: rejectionMessage(rows[0]),
      };
    }
    throw uncertain();
  }
  async consult(companyId: string, r: ArcaVoucherRequest) {
    association(r);
    const result = await this.call(
      companyId,
      r.issuerCuit,
      'FECompConsultar',
      `<FeCompConsReq>${tag('CbteTipo', r.voucherType)}${tag('CbteNro', r.voucherNumber)}${tag('PtoVta', r.pointOfSale)}</FeCompConsReq>`,
    );
    const failures = errors(result);
    if (
      failures.length === 1 &&
      value(failures[0], 'Code') === '602' &&
      !children(result, 'ResultGet', NS).length
    )
      return null;
    noErrors(result);
    const invoice = child(result, 'ResultGet', NS);
    matchesDetail(invoice, r);
    same(invoice, 'PtoVta', r.pointOfSale);
    same(invoice, 'CbteTipo', r.voucherType);
    same(invoice, 'Resultado', 'A');
    same(invoice, 'EmisionTipo', 'CAE');
    same(invoice, 'MonId', 'PES');
    money(invoice, 'MonCotiz', '1');
    same(invoice, 'CondicionIVAReceptorId', r.recipientVatConditionId);
    money(invoice, 'ImpTotal', r.total);
    money(invoice, 'ImpTotConc', r.notTaxed);
    money(invoice, 'ImpNeto', r.net);
    money(invoice, 'ImpOpEx', r.exempt);
    money(invoice, 'ImpTrib', '0');
    money(invoice, 'ImpIVA', r.vat);
    matchesAssociation(invoice, r);
    for (const field of [
      'Tributos',
      'Opcionales',
      'Compradores',
      'PeriodoAsoc',
      'Actividades',
    ]) {
      const extra = children(invoice, field, NS);
      if (
        extra.length > 1 ||
        extra.some((node) => node.children.length || node.text.trim())
      )
        throw uncertain();
    }
    for (const field of [
      'FchServDesde',
      'FchServHasta',
      'FchVtoPago',
      'CanMisMonExt',
    ])
      if (optional(invoice, field)) throw uncertain();
    const iva = children(invoice, 'Iva', NS).length
      ? children(child(invoice, 'Iva', NS), 'AlicIva', NS)
      : [];
    if (iva.length !== r.iva.length) throw uncertain();
    for (const expected of r.iva) {
      const rows = iva.filter(
        (row) => value(row, 'Id') === String(expected.id),
      );
      if (rows.length !== 1) throw uncertain();
      money(rows[0], 'BaseImp', expected.base);
      money(rows[0], 'Importe', expected.amount);
    }
    return authorization(invoice, 'CodAutorizacion', 'FchVto');
  }
}
