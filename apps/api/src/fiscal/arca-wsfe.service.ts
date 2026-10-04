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
import { validFiscalDate, type ArcaInvoiceRequest } from './fiscal-request';

export type { ArcaInvoiceRequest } from './fiscal-request';

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
function matchesDetail(node: XmlNode, r: ArcaInvoiceRequest) {
  same(node, 'Concepto', 1);
  same(node, 'DocTipo', 80);
  same(node, 'DocNro', r.recipientCuit);
  same(node, 'CbteDesde', r.voucherNumber);
  same(node, 'CbteHasta', r.voucherNumber);
  same(node, 'CbteFch', r.date);
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
    r: Omit<ArcaInvoiceRequest, 'voucherNumber'>,
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
    const invoiceClass =
      r.voucherType === 1 ? 'A' : r.voucherType === 6 ? 'B' : 'C';
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
  async authorize(companyId: string, r: ArcaInvoiceRequest) {
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
        message:
          'ARCA rechazó el comprobante de homologación. Revisá los datos fiscales.',
      };
    }
    throw uncertain();
  }
  async consult(companyId: string, r: ArcaInvoiceRequest) {
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
    for (const field of [
      'Tributos',
      'CbtesAsoc',
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
