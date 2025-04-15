import React, { useEffect, useState, useRef } from 'react'
import supabase from './utils/supabase'
import openaiService from './utils/openai'

const App = () => {
  const [session, setSession] = useState(null);

  const [messages, setMessages] = useState([])
  const [newMessage, setNewMessage] = useState('')
  const [usersOnline, setUsersOnline] = useState([])
  
  // OpenAI Assistant states
  const [threadId, setThreadId] = useState(null)
  const [isAiResponding, setIsAiResponding] = useState(false)
  const [aiEnabled, setAiEnabled] = useState(true)

  const [menu, setMenu] = useState(false)
  const menuRef = useRef(null)

  const chatContainerRef = useRef(null)

  useEffect(() => {
    async function fetchSession() {
      const { data: { session } } = await supabase.auth.getSession(); // checking for session on client side
      setSession(session);
    };

    fetchSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);
  
  // Initialize OpenAI thread when user signs in
  useEffect(() => {
    const initializeThread = async () => {
      if (session?.user) {
        try {
          // Check if we have a thread ID in localStorage
          const savedThreadId = localStorage.getItem(`openai_thread_${session.user.id}`);
          
          if (savedThreadId) {
            setThreadId(savedThreadId);
          } else {
            // Create a new thread
            const thread = await openaiService.createThread();
            setThreadId(thread.id);
            localStorage.setItem(`openai_thread_${session.user.id}`, thread.id);
          }
        } catch (error) {
          console.error('Error initializing OpenAI thread:', error);
        }
      }
    };
    
    initializeThread();
  }, [session]);

  // SINGIN FUNCTION
  async function signIn() {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: import.meta.env.VITE_REDIRECT_URL
      }
    });
  };

  // SIGNOUT FUNCTION
  async function signOut() {
    const { error } = supabase.auth.signOut();
  }

  // supabase websocket
  useEffect(() => {
    if (!session?.user) {
      setUsersOnline([])
    }

    const roomOne = supabase.channel('room_one', {
      config: {
        presence: {
          key: session?.user?.id,
        },
      },
    })

    roomOne.on("broadcast", { event: "message" }, (payload) => {
      setMessages(prevMessages => [...prevMessages, payload]);
    })

    // track user presence 
    roomOne.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await roomOne.track({
          id: session?.user?.id,
        });
      }
    })

    // set number of users online
    roomOne.on("presence", { event: 'sync' }, () => {
      const state = roomOne.presenceState();
      setUsersOnline(Object.keys(state))
    })

    return () => {
      roomOne.unsubscribe();
    }

  }, [session])

  // send message handler
  async function sendMessage(e) {
    e.preventDefault();
    
    if (!newMessage.trim()) return;
    
    // Send message to chat room
    supabase.channel("room_one").send({
      type: "broadcast",
      event: "message",
      payload: {
        message: newMessage,
        email: session?.user?.email,
        user: session?.user?.user_metadata?.name,
        avatar: session?.user?.user_metadata?.avatar_url,
        timestamp: new Date().toISOString(),
      },
    });
    
    // If AI is enabled, send message to OpenAI Assistant
    if (aiEnabled && threadId) {
      setIsAiResponding(true);
      
      try {
        // Send message to OpenAI Assistant
        const assistantResponse = await openaiService.sendMessageToAssistant(threadId, newMessage);
        
        // Extract the assistant's response content
        let responseText = '';
        if (assistantResponse && assistantResponse.content && assistantResponse.content.length > 0) {
          responseText = assistantResponse.content[0].text.value;
        }
        
        // Add AI response to chat
        if (responseText) {
          supabase.channel("room_one").send({
            type: "broadcast",
            event: "message",
            payload: {
              message: responseText,
              email: 'ai-assistant@gigachat.ai', // Special email for AI
              user: 'AI Assistant',
              avatar: 'https://api.dicebear.com/7.x/bottts/svg?seed=gpt', // AI avatar
              timestamp: new Date().toISOString(),
              isAI: true,
            },
          });
        }
      } catch (error) {
        console.error('Error getting AI response:', error);
        // Notify users of error
        supabase.channel("room_one").send({
          type: "broadcast",
          event: "message",
          payload: {
            message: "Sorry, I couldn't get a response from the AI assistant. Please try again later.",
            email: 'system@gigachat.ai',
            user: 'System',
            avatar: 'https://api.dicebear.com/7.x/bottts/svg?seed=system',
            timestamp: new Date().toISOString(),
            isSystem: true,
          },
        });
      } finally {
        setIsAiResponding(false);
      }
    }
    
    setNewMessage("");
  }

  // TOGGLE MENU
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setMenu(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  function showMenu() {
    setMenu(!menu)
  }
  
  // Toggle AI Assistant
  function toggleAI() {
    setAiEnabled(!aiEnabled);
    
    // Notify users about AI status change
    supabase.channel("room_one").send({
      type: "broadcast",
      event: "message",
      payload: {
        message: !aiEnabled ? "AI Assistant has been enabled." : "AI Assistant has been disabled.",
        email: 'system@gigachat.ai',
        user: 'System',
        avatar: 'https://api.dicebear.com/7.x/bottts/svg?seed=system',
        timestamp: new Date().toISOString(),
        isSystem: true,
      },
    });
  }

  // Scroll to bottom when new chat comes
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messages]);

  // if session doesn't exist, ask for login
  if (!session) {
    return (
      <div className='w-full h-screen flex flex-col justify-center items-center -mt-15'>
        <h1 className='text-6xl font-bold mb-10'>Giga Chat 🗿</h1>
        <button onClick={signIn} className='px-4 py-2 rounded cursor-pointer bg-blue-600 hover:bg-blue-700'>Sign in with Google to start chatting!</button>
      </div>
    )
  }

  // if session exists, show the chat
  return (
    <div className='w-full h-screen flex flex-col justify-center items-center p-4'>
      {/* <h1 className='mb-4 text-2xl font-bold text-green-400'>Giga Chat</h1> */}
      {/* <h1 className='text-6xl font-bold mb-10'>Giga Chat 🗿</h1> */}

      <div className='w-full max-w-6xl min-h-[600px] border border-gray-500 rounded-lg'>

        {/* HEADER */}
        <div className='h-20 border-b border-gray-500 flex items-center justify-between px-4'>
          <div>
            <p className='break-words'>Welcome {session?.user?.user_metadata?.name} 🗿</p>
            <div className='flex items-center text-gray-400'>{usersOnline.length} Users online <div className='w-2 h-2 bg-green-500 rounded-full ml-1.5 mt-[4.78px] animate-pulse'></div></div>
          </div>
          <div ref={menuRef} className='relative'>
            <div onClick={showMenu} className='w-10 h-10 cursor-pointer'>
              <img src={session?.user?.user_metadata?.avatar_url} alt="profile" className='rounded' />
            </div>
            <div className={`absolute right-0 ${menu ? 'opacity-100' : 'opacity-0 pointer-events-none'} z-10 mt-1 flex flex-col gap-2 transition-opacity duration-300`}>
              <button
                onClick={toggleAI}
                className={`cursor-pointer rounded-md px-3 py-2 ${aiEnabled ? 'bg-green-600 hover:bg-green-700' : 'bg-gray-600 hover:bg-gray-700'}`}
              >
                {aiEnabled ? 'AI: On' : 'AI: Off'}
              </button>
              <button
                onClick={signOut}
                className='cursor-pointer rounded-md px-3 py-2 bg-red-600 hover:bg-red-700'
              >
                Signout
              </button>
            </div>
          </div>
        </div>

        {/* MAIN CHAT */}
        <div ref={chatContainerRef} className='h-[500px] flex flex-col p-4 overflow-y-auto text-white'>
          {messages.map((msg, index) => (
            <div key={index} className={`w-full my-1.5 flex flex-col ${msg.payload.email === session?.user?.email ? "items-end" : "items-start"}`}>
              {/* Username display */}
              <span className="text-xs text-gray-400 mb-1 ml-11 mr-1">
                {msg.payload.email === session?.user?.email ? 'You' : msg.payload.user}
              </span>
              
              <div className={`w-full flex items-start ${msg.payload.email === session?.user?.email ? "justify-end" : "justify-start"}`}>
                {msg?.payload.email !== session?.user?.email &&
                  <img src={msg.payload.avatar} alt="pfp" className='w-9 h-9 rounded-full mr-2' />
                }

                <div className={`max-w-[70%] px-4 pb-2 pt-1.5 rounded-4xl break-words ${msg?.payload.isAI ? "bg-purple-700" : msg?.payload.isSystem ? "bg-gray-700" : msg?.payload.email === session?.user?.email ? "bg-blue-600" : "bg-neutral-800"}`}>
                  <p>{msg.payload.message}</p>
                </div>

                {msg?.payload.email === session?.user?.email &&
                  <img src={msg.payload.avatar} alt="pfp" className='w-9 h-9 rounded-full ml-2' />
                }
              </div>
            </div>
          ))}
        </div>

        {/* INPUT FIELD */}
        <form onSubmit={sendMessage} className='flex p-4 border-t border-gray-500' >
          <input
            type="text"
            placeholder='Type a message...'
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            disabled={isAiResponding}
            className='border border-gray-500 rounded-lg p-2 w-full bg-[#46464640] disabled:opacity-50'
          />
          <button 
            disabled={isAiResponding || !newMessage.trim()}
            className='px-4 py-1 rounded-md ml-4 bg-blue-600 hover:bg-blue-700 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2'
          >
            {isAiResponding ? (
              <>
                <span className="animate-pulse">AI thinking...</span>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              </>
            ) : 'Send'}
          </button>
        </form>

      </div>
    </div>
  )
}

export default App

// im going to give the best effort i've ever given in life.