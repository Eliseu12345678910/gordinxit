// Importar este arquivo no seu server.ts ou app.ts para testes de integração

import {
  sendMessage,
  getChatMessages,
  createOrGetChat,
  updateChatAnswers,
  getAllChats,
  getChat,
  findChatByPhone,
} from '@/app/actions'
import { AutomationAnswers } from '@/types/chat'

/**
 * Example: Create a new chat and send messages
 * 
 * Exemplo para testes: Criar um novo chat e enviar mensagens
 */
export async function exampleCreateChatAndMessage() {
  const chatId = 'example-chat-001'
  const phone = '(11) 99999-9999'

  // 1. Create or get chat
  const chat = await createOrGetChat(chatId, phone)
  console.log('Chat criado:', chat)

  // 2. Update automation answers
  const answers: AutomationAnswers = {
    knowsProduct: true,
    wantsToBuyToday: true,
    wantsSpecialDeal: true,
    phone: phone,
  }

  await updateChatAnswers(chatId, answers, true)
  console.log('Respostas atualizadas')

  // 3. Send messages
  await sendMessage(chatId, 'Olá! Bem-vindo ao chat.', 'bot')
  await sendMessage(chatId, 'Obrigado pelas respostas!', 'admin')
  await sendMessage(chatId, 'Ótimo, vou te ajudar.', 'admin')
  console.log('Mensagens enviadas')

  // 4. Get all messages
  const messages = await getChatMessages(chatId)
  console.log('Mensagens carregadas:', messages)

  // 5. Get single chat
  const singleChat = await getChat(chatId)
  console.log('Chat único:', singleChat)
}

/**
 * Example: Get all chats for admin dashboard
 * 
 * Exemplo: Buscar todos os chats para dashboard do admin
 */
export async function exampleGetAllChatsForAdmin() {
  const allChats = await getAllChats()
  console.log('Todos os chats:', allChats)

  // Filter by status
  const openChats = allChats.filter((chat) => chat.status === 'open')
  console.log('Chats abertos:', openChats)

  // Sort by updated time
  const recentChats = allChats.sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  )
  console.log('Chats recentes:', recentChats)
}

/**
 * Example: Find chat by phone number
 * 
 * Exemplo: Buscar chat pelo número de telefone
 */
export async function exampleFindChatByPhone() {
  const phone = '(11) 99999-9999'
  const existingChat = await findChatByPhone(phone)

  if (existingChat) {
    console.log('Chat existente encontrado:', existingChat)
  } else {
    console.log('Nenhum chat encontrado para este telefone')
  }
}

/**
 * Example: Complete automation flow
 * 
 * Exemplo: Fluxo completo de automação
 */
export async function exampleCompleteAutomationFlow() {
  const chatId = 'example-automation-001'
  const phone = '(21) 98888-8888'

  // Step 1: Create chat
  await createOrGetChat(chatId, phone)

  // Step 2: User answers all 4 questions
  const answers: AutomationAnswers = {
    knowsProduct: false,
    wantsToBuyToday: true,
    wantsSpecialDeal: true,
    phone: phone,
  }

  // Step 3: Mark automation as complete
  await updateChatAnswers(chatId, answers, true)

  // Step 4: Send bot message
  const botMessage = `Obrigado pelas respostas! Você ainda não conhece nossos produtos, então vou detalhar tudo para você. Um de nossos atendentes entrará em contato em breve.`
  await sendMessage(chatId, botMessage, 'bot')

  // Step 5: Admin responds
  await sendMessage(
    chatId,
    'Olá! Vi suas respostas e vou te ajudar agora.',
    'admin'
  )
  await sendMessage(
    chatId,
    'Esse produto está disponível hoje. Quer que eu te mande as opções?',
    'admin'
  )

  // Step 6: Client responds
  await sendMessage(chatId, 'Sim, gostaria de ver as opções!', 'client')

  // Step 7: View complete conversation
  const allMessages = await getChatMessages(chatId)
  console.log('Conversa completa:', allMessages)
}

/**
 * Example: Real-time monitoring (simulated)
 * 
 * Exemplo: Monitoramento em tempo real (simulado)
 */
export async function exampleMonitorChatsInRealtime() {
  console.log('Iniciando monitoramento de chats...')

  // In a real app, use Firestore listeners
  const interval = setInterval(async () => {
    const allChats = await getAllChats()
    const activeChats = allChats.filter((chat) => chat.status === 'open')
    const chatsDuringAutomation = allChats.filter(
      (chat) => chat.status === 'automation'
    )

    console.log(`
      📊 Status do Dashboard:
      - Chats Abertos: ${activeChats.length}
      - Em Automação: ${chatsDuringAutomation.length}
      - Total: ${allChats.length}
      - Atualizado em: ${new Date().toLocaleTimeString('pt-BR')}
    `)
  }, 5000)

  // Stop after 1 minute (for testing)
  setTimeout(() => {
    clearInterval(interval)
    console.log('Monitoramento encerrado')
  }, 60000)
}

// Usage in tests or CLI
if (require.main === module) {
  console.log('Chat Application - Integration Test Examples')
  console.log('=============================================\n')

  console.log('❌ Note: These are example functions.')
  console.log('✅ They require Firebase to be configured in .env.local')
  console.log('✅ Call them from your test suite or server code\n')

  console.log('Available examples:')
  console.log('- exampleCreateChatAndMessage()')
  console.log('- exampleGetAllChatsForAdmin()')
  console.log('- exampleFindChatByPhone()')
  console.log('- exampleCompleteAutomationFlow()')
  console.log('- exampleMonitorChatsInRealtime()')
}
