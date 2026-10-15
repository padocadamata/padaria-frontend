import { createClient } from '../supabase/client';
import { ehLayoutPadrao, layoutValidoParaBanco } from './layout';

// Leitura/gravação da preferência de layout do Dashboard do usuário logado
// (public.usuario_dashboard_layout, migration 0075). A RLS só deixa ler e
// gravar a PRÓPRIA linha; usuario_id é forçado para auth.uid() no banco.

// { widgets: [...] | null, disponivel }. widgets = null -> sem preferência
// (layout padrão). disponivel = false -> tabela ausente/ilegível (0075 não
// aplicada): o Dashboard funciona normalmente e só não oferece Personalizar.
export async function carregarLayoutDashboard() {
  const supabase = createClient();
  const { data, error } = await supabase.from('usuario_dashboard_layout').select('widgets').maybeSingle();
  if (error) {
    console.error('Personalização do Dashboard indisponível:', error);
    return { widgets: null, disponivel: false };
  }
  return { widgets: Array.isArray(data?.widgets) ? data.widgets : null, disponivel: true };
}

// Layout igual ao padrão -> apaga a preferência (o usuário volta a seguir o
// padrão, inclusive futuras mudanças nele). Senão, grava (upsert da própria
// linha). Retorna { erro } ('' quando deu certo).
export async function salvarLayoutDashboard(usuarioId, layout) {
  const supabase = createClient();
  if (ehLayoutPadrao(layout)) {
    const { error } = await supabase.from('usuario_dashboard_layout').delete().eq('usuario_id', usuarioId);
    if (error) {
      console.error('Erro ao restaurar o Dashboard padrão:', error);
      return { erro: 'Não foi possível restaurar o padrão. Tente novamente.' };
    }
    return { erro: '' };
  }
  const widgets = layout.map(({ id, tamanho }) => ({ id, tamanho }));
  if (!layoutValidoParaBanco(widgets)) return { erro: 'Layout inválido.' };
  const { error } = await supabase
    .from('usuario_dashboard_layout')
    .upsert({ usuario_id: usuarioId, widgets }, { onConflict: 'usuario_id' });
  if (error) {
    console.error('Erro ao salvar o Dashboard:', error);
    return { erro: 'Não foi possível salvar a personalização. Tente novamente.' };
  }
  return { erro: '' };
}
