import type { WithdrawalSummary } from '@rastro/core';
import type { Lang } from './format';

// The withdrawal statuses as a person would say them.
export const STATUS: Record<Lang, Record<WithdrawalSummary['status'], string>> = {
  pt: {
    SOLICITADO: 'Pedido',
    TBRL_NA_TESOURARIA: 'tBRL na tesouraria',
    PIX_ENVIADO: 'Pix a caminho',
    PIX_CONFIRMADO: 'Pix confirmado',
    QUEIMADO: 'tBRL queimado',
    CONCLUIDO: 'Concluído',
    FALHOU: 'Pix recusado',
    DEVOLVIDO: 'Devolvido à carteira',
    CANCELADO: 'Cancelado',
  },
  en: {
    SOLICITADO: 'Requested',
    TBRL_NA_TESOURARIA: 'tBRL at the treasury',
    PIX_ENVIADO: 'Pix on its way',
    PIX_CONFIRMADO: 'Pix confirmed',
    QUEIMADO: 'tBRL burned',
    CONCLUIDO: 'Done',
    FALHOU: 'Pix refused',
    DEVOLVIDO: 'Returned to the wallet',
    CANCELADO: 'Cancelled',
  },
};

export const FINAL: readonly WithdrawalSummary['status'][] = ['CONCLUIDO', 'DEVOLVIDO', 'CANCELADO'];

// "Bramble & Pike Software, Inc." -> "Bramble & Pike", the way Ana would say it.
export const shortCompany = (name: string) => name.replace(/,? Inc\.?$/, '').replace(/ Software$/, '');
