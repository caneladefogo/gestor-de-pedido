# Manual de homologação pré-deploy — Canela de Fogo

Data da revisão técnica: 23/08/2026

## Como homologar

Execute os testes preferencialmente com dois aparelhos ou duas janelas: uma no Cadastro de Pedidos e outra no Painel da Cozinha. Para cada cenário, registre `Aprovado`, `Reprovado` ou `Não testado`, dispositivo, horário e evidência.

Antes de começar, anote a quantidade de pedidos, a sequência de senhas e o estoque atual. Não use pedidos reais para testar exclusão, limpeza de histórico ou reinício de senhas.

## 1. Abertura, navegação e responsividade

- [ ] **HOM-001 — Seleção de atendente:** abrir o sistema, selecionar um atendente e confirmar que seu nome aparece no cabeçalho.
- [ ] **HOM-002 — Navegação principal:** alternar entre Cadastro de Pedidos, Painel da Cozinha, Chapeiro e Estoque sem perder os dados.
- [ ] **HOM-003 — Cabeçalho mobile:** em celular, verificar se botões ficam abaixo do título quando necessário e nenhum botão é cortado.
- [ ] **HOM-004 — Cardápio mobile:** rolar a lista e confirmar que nenhum produto fica escondido pelo cabeçalho ou pela barra do carrinho.
- [ ] **HOM-005 — Diálogos:** abrir os diálogos no desktop e celular; confirmar que cabem na tela, possuem rolagem interna e fecham ao clicar fora.
- [ ] **HOM-006 — Tecla Enter:** preencher cada diálogo usando Enter; confirmar avanço para o próximo campo e salvamento no último campo aplicável.

## 2. Cadastro de pedido comum

- [ ] **HOM-007 — Criação sem senha antecipada:** iniciar um pedido e confirmar que a senha ainda não foi criada.
- [ ] **HOM-008 — Identificação:** cadastrar nome, característica/mesa e prioridade; confirmar os dados no carrinho e posteriormente no painel.
- [ ] **HOM-009 — Prioridades:** testar Normal, Idoso 60+, Idoso 80+, Gestante, PCD, Autista e Pessoa com criança de colo; confirmar destaque e ordenação prioritária.
- [ ] **HOM-010 — Local individual:** criar um prato para consumo local e outro para levar; confirmar o indicador individual em cada item.
- [ ] **HOM-011 — Bebidas sem local:** adicionar bebidas e confirmar que não exibem “Comer no local” nem “Para levar”.
- [ ] **HOM-012 — Total no cabeçalho:** adicionar e remover itens; confirmar atualização imediata do total no cabeçalho do cadastro.
- [ ] **HOM-013 — Preços no cardápio:** confirmar valores ao lado do botão de adicionar, incluindo sucos a R$ 8,00.

## 3. Pratos

- [ ] **HOM-014 — Carne na Chapa:** montar com quantidade, arroz, retiradas e local de consumo.
- [ ] **HOM-015 — Picanha:** repetir o cenário anterior e conferir o preço correspondente.
- [ ] **HOM-016 — Vatapá:** confirmar que Vatapá aparece entre as opções de retirada de Carne na Chapa e Picanha.
- [ ] **HOM-017 — Prato completo:** sem retiradas, confirmar o texto “Completo”.
- [ ] **HOM-018 — Prato com retiradas:** conferir no painel as linhas “Retirar” e “Prato montado”, com os respectivos componentes.
- [ ] **HOM-019 — Arroz destacado:** confirmar uma linha exclusiva para o tipo de arroz no painel.
- [ ] **HOM-020 — Local destacado:** confirmar uma linha individual e destacada para consumo local/viagem em cada prato.
- [ ] **HOM-021 — Quantidade:** cadastrar duas ou mais unidades e confirmar quantidade, subtotal e métricas.

## 4. Caldos

- [ ] **HOM-022 — Sabores:** confirmar Carne, Quenga, Camarão e Frango.
- [ ] **HOM-023 — Organização visual:** confirmar tamanho, acompanhamentos e local em linhas legíveis, seguindo o padrão visual dos pratos.
- [ ] **HOM-024 — Camarão 350 ml:** validar R$ 18,00 sem acompanhamento e R$ 20,00 com acompanhamento.
- [ ] **HOM-025 — Camarão 500 ml:** validar R$ 25,00 sem acompanhamento e R$ 30,00 com acompanhamento.
- [ ] **HOM-026 — Preço dinâmico:** alternar tamanho, sabor, acompanhamento e quantidade; confirmar atualização imediata de unitário e total.
- [ ] **HOM-027 — Quantidade e local:** confirmar quantidade e indicador individual de local/viagem.

## 5. Carrinho, edição e troco

- [ ] **HOM-028 — Espaço útil:** com vários itens, abrir o carrinho no celular e desktop; confirmar que a lista possui área útil suficiente e rolagem própria.
- [ ] **HOM-029 — Alteração de quantidade:** usar `+` e `−` no carrinho; confirmar total, subtotal e contador imediatamente.
- [ ] **HOM-030 — Exclusão facilitada:** excluir um item pela lixeira arredondada e confirmar recálculo imediato.
- [ ] **HOM-031 — Edição completa:** editar prato e caldo pelo lápis; alterar todas as opções e confirmar substituição correta no carrinho.
- [ ] **HOM-032 — Troco recolhido:** abrir o carrinho e confirmar que o formulário de troco está fechado.
- [ ] **HOM-033 — Cálculo do troco:** abrir pelo botão, informar valor recebido e conferir o troco. Testar valor igual, maior e menor que o total.
- [ ] **HOM-034 — Pedido já enviado:** editar pedido existente, adicionar itens e conferir separadamente “Total do pedido” e “Novos itens”.

## 6. Envio, senha e timer

- [ ] **HOM-039 — Envio à cozinha:** enviar um pedido comum; confirmar criação da senha somente nesse momento e recebimento no painel.
- [ ] **HOM-041 — Timer inicial:** antes do envio, confirmar que não há timer ativo; após envio, confirmar início em 00:00.
- [ ] **HOM-042 — Timer imutável:** editar, remover todos os itens e adicionar novos em pedido existente; confirmar que o início do timer não muda.
- [ ] **HOM-043 — Anotação da cozinha:** abrir o campo recolhido, salvar uma anotação e confirmar que o timer não reinicia.
- [ ] **HOM-044 — Ordenação:** confirmar que pedidos da mesma prioridade são ordenados pelo maior tempo de espera.
- [ ] **HOM-045 — Previsão:** confirmar exibição de espera real e previsão de entrega baseada na posição e nos tempos configurados.
- [ ] **HOM-046 — Tempos administrativos:** alterar tempos-base e incrementos de Carne, Picanha e Caldo; confirmar atualização das previsões e depois restaurar os valores oficiais.

## 7. Fluxo da cozinha

- [ ] **HOM-047 — Aba Pedidos:** confirmar que todos os itens do pedido aparecem juntos, incluindo pratos, caldos e bebidas.
- [ ] **HOM-048 — Aba Prontos:** marcar um pedido como pronto e confirmar sua transferência integral para essa aba.
- [ ] **HOM-049 — Movimentação:** mover um pedido de Fila para Pronto e confirmar a atualização simultânea no atendimento.
- [ ] **HOM-050 — Entrega pela cozinha:** entregar um pedido pronto e confirmar transferência imediata para Entregues, sem nova notificação.
- [ ] **HOM-051 — Mudança de estado:** editar um pedido e alterar manualmente seu estado; confirmar a coluna de destino.
- [ ] **HOM-052 — Edição completa pelo painel:** abrir o editor completo e adicionar/remover/configurar pratos, caldos e bebidas como no cadastro.
- [ ] **HOM-053 — Chapeiro:** confirmar somente Carne e Picanha, com contadores correspondentes e sem controle de finalização.
- [ ] **HOM-054 — Pedido misto:** enviar prato, caldo e bebida juntos; confirmar que todos aparecem no mesmo cartão.

## 8. Pronto, entrega, alarme e exclusão

- [ ] **HOM-055 — Alarme de pronto:** marcar pedido como pronto; no atendimento, confirmar mensagem para chamar o cliente contendo nome e senha.
- [ ] **HOM-056 — Entrega pelo atendente:** entregar e confirmar retirada de Prontos e entrada em Entregues.
- [ ] **HOM-057 — Entrega pela cozinha:** repetir pelo painel mestre e confirmar sincronização no atendimento.
- [ ] **HOM-058 — Exclusão definitiva no atendimento:** excluir um pedido de teste e confirmar desaparecimento em todas as telas após recarregar.
- [ ] **HOM-059 — Exclusão definitiva na cozinha:** repetir no painel; confirmar que não vai para lixeira/histórico e não retorna pela sincronização.

## 10. Histórico, métricas e senhas

- [ ] **HOM-060 — Visibilidade:** confirmar que métricas, limpeza e reinício de senhas aparecem somente em Entregues.
- [ ] **HOM-061 — Pedidos entregues:** comparar a quantidade do badge com os cartões do histórico.
- [ ] **HOM-062 — Itens históricos:** somar todas as quantidades dos pedidos e comparar com “Itens no histórico”.
- [ ] **HOM-063 — Pratos:** conferir totais de Carne de Sol na Chapa e Picanha na Chapa.
- [ ] **HOM-064 — Arroz por prato:** conferir Arroz Branco, Arroz com Brócolis e Baião de Dois separadamente dentro de Carne e Picanha.
- [ ] **HOM-065 — Caldos:** conferir Carne, Quenga, Camarão e Frango, divididos em “Com acompanhamento” e “Sem acompanhamento”.
- [ ] **HOM-066 — Tempo médio real:** comparar uma amostra usando `hora da entrega − hora de envio`.
- [ ] **HOM-067 — Limpar histórico:** limpar somente após criar cópia/evidência; confirmar que entregues não reaparecem após aguardar e recarregar.
- [ ] **HOM-068 — Reiniciar senhas:** confirmar que o próximo pedido comum recebe #001.
- [ ] **HOM-069 — Virada do dia:** simular/validar em ambiente controlado que a primeira senha de um novo dia reinicia em #001.

## 11. Estoque de bebidas

- [ ] **HOM-070 — Layout:** abrir no celular e desktop; confirmar textos dentro dos cards, sem rolagem lateral da página.
- [ ] **HOM-071 — Entrada:** registrar entrada e conferir saldo e histórico.
- [ ] **HOM-072 — Saída:** registrar saída válida e bloquear saída superior ao saldo.
- [ ] **HOM-073 — Ajuste:** definir saldo e estoque mínimo; conferir alerta de reposição.
- [ ] **HOM-074 — Baixa por venda:** entregar pedido com bebida e confirmar baixa única no estoque.
- [ ] **HOM-075 — Zerar individualmente:** usar “Zerar estoque” em uma bebida de teste; confirmar saldo zero, histórico e sincronização.

## 12. Persistência, conexão e simultaneidade

- [ ] **HOM-076 — Recarregamento:** criar pedido de teste, recarregar atendimento e cozinha e confirmar permanência dos dados.
- [ ] **HOM-077 — Queda de internet no envio:** desligar a rede, enviar pedido, confirmar indicador offline/pendente; religar e confirmar envio automático e ACK da cozinha.
- [ ] **HOM-078 — Alteração offline:** sem rede, marcar pedido como pronto/entregue; reconectar e confirmar propagação sem duplicidade.
- [ ] **HOM-079 — Recebimento após reconexão:** manter receptor offline enquanto outro aparelho altera um pedido; reconectar e confirmar estado mais recente.
- [ ] **HOM-080 — Duas telas simultâneas:** editar estados em aparelhos distintos e confirmar convergência para a alteração mais recente.
- [ ] **HOM-081 — Pedido não some:** manter pedidos abertos por período prolongado, alternar abas e recarregar; confirmar que permanecem.
- [ ] **HOM-082 — Indicador dinâmico:** desligar/ligar a rede e medir se o cabeçalho muda rapidamente entre offline, pendente e sincronizado.

## Critérios para autorizar deploy

- Todos os cenários críticos HOM-039 a HOM-059 e HOM-076 a HOM-082 devem estar aprovados.
- Nenhum pedido pode desaparecer, duplicar ou mudar de estado incorretamente.
- Totais, troco, estoque e métricas devem fechar com a conferência manual.
- Não pode existir corte de botões, página com rolagem horizontal indevida ou diálogo inacessível nos aparelhos usados na operação.
- Fazer cópia dos dados locais antes do deploy e manter a versão anterior pronta para rollback.

## Limitação conhecida

A colisão de senhas em envios realmente simultâneos permanece dependente da implementação de backend transacional, conforme decisão anterior. A versão atual reduz falhas de transporte com persistência local, reenvio e confirmação de recebimento, mas o frontend sozinho não consegue garantir exclusividade global de senha entre dois dispositivos no mesmo instante.
