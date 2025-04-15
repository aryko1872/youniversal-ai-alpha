import OpenAI from 'openai';

// Initialize the OpenAI client with API key from environment variables
const openai = new OpenAI({
  apiKey: import.meta.env.VITE_OPENAI_API_KEY,
  dangerouslyAllowBrowser: true // Only use this for development - in production, use a backend
});

// Default assistant ID from environment variables
const defaultAssistantId = import.meta.env.VITE_OPENAI_ASSISTANT_ID;

// Create a new thread
export const createThread = async () => {
  try {
    const thread = await openai.beta.threads.create();
    return thread;
  } catch (error) {
    console.error('Error creating thread:', error);
    throw error;
  }
};

// Send a message to the assistant and get a response
export const sendMessageToAssistant = async (threadId, message, assistantId = defaultAssistantId) => {
  try {
    // Add the user message to the thread
    await openai.beta.threads.messages.create(threadId, {
      role: 'user',
      content: message,
    });

    // Run the assistant on the thread
    const run = await openai.beta.threads.runs.create(threadId, {
      assistant_id: assistantId,
    });

    // Poll for the run completion
    let runStatus = await openai.beta.threads.runs.retrieve(threadId, run.id);
    
    // Wait until the run is completed
    while (runStatus.status !== 'completed' && runStatus.status !== 'failed') {
      await new Promise(resolve => setTimeout(resolve, 1000));
      runStatus = await openai.beta.threads.runs.retrieve(threadId, run.id);
      
      if (runStatus.status === 'requires_action') {
        // Handle function calling if needed
        console.log('Function calling required but not implemented in this example');
        break;
      }
    }

    // Get the messages, including the assistant's response
    const messages = await openai.beta.threads.messages.list(threadId);
    
    // Return the latest assistant message
    const assistantMessages = messages.data
      .filter(msg => msg.role === 'assistant')
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    
    return assistantMessages[0];
  } catch (error) {
    console.error('Error sending message to assistant:', error);
    throw error;
  }
};

// Get all messages in a thread
export const getThreadMessages = async (threadId) => {
  try {
    const messages = await openai.beta.threads.messages.list(threadId);
    return messages.data;
  } catch (error) {
    console.error('Error getting thread messages:', error);
    throw error;
  }
};

export default {
  createThread,
  sendMessageToAssistant,
  getThreadMessages
};
