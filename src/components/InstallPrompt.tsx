import React, { useState, useEffect } from 'react';
import { Download, Monitor, Smartphone, CheckCircle2, AlertCircle, ExternalLink, ArrowUpRight } from 'lucide-react';

export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isInstalled, setIsInstalled] = useState(false);

  const [isSafari, setIsSafari] = useState(false);
  const [isChrome, setIsChrome] = useState(false);
  const [showManualInstructions, setShowManualInstructions] = useState(false);

  useEffect(() => {
    // Check if browser is Safari
    const isSafariBrowser = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
    setIsSafari(isSafariBrowser);

    // Check if browser is Chrome/Edge
    const isChromeBrowser = /chrome|chromium|crios/i.test(navigator.userAgent) && !isSafariBrowser;
    setIsChrome(isChromeBrowser);

    // Show manual instructions after 5 seconds if prompt hasn't appeared
    const timer = setTimeout(() => {
      if (!deferredPrompt && !isInstalled) {
        setShowManualInstructions(true);
      }
    }, 5000);

    // Check if app is already installed
    if (window.matchMedia('(display-mode: standalone)').matches) {
      setIsInstalled(true);
    }

    const handler = (e: any) => {
      // Prevent Chrome 67 and earlier from automatically showing the prompt
      e.preventDefault();
      // Stash the event so it can be triggered later.
      setDeferredPrompt(e);
    };

    window.addEventListener('beforeinstallprompt', handler);

    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;

    // Show the prompt
    deferredPrompt.prompt();

    // Wait for the user to respond to the prompt
    const { outcome } = await deferredPrompt.userChoice;
    
    if (outcome === 'accepted') {
      console.log('User accepted the install prompt');
      setIsInstalled(true);
    } else {
      console.log('User dismissed the install prompt');
    }

    // We've used the prompt, and can't use it again
    setDeferredPrompt(null);
  };

  if (isInstalled) {
    return (
      <div className="bg-green-50 p-6 rounded-2xl border border-green-100 flex items-center gap-4">
        <div className="p-3 bg-green-100 text-green-600 rounded-full">
          <CheckCircle2 size={24} />
        </div>
        <div>
          <h3 className="font-bold text-green-900">App Successfully Installed</h3>
          <p className="text-sm text-green-700">Azat Studio is now running as a native app on your device. You can find it in your Applications folder or Home Screen.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-100 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-blue-50 text-blue-600 rounded-xl">
            <Download size={24} />
          </div>
          <div>
            <h3 className="font-bold text-xl text-gray-900">Install as Desktop/Mobile App</h3>
            <p className="text-sm text-gray-500">No DMG or App Store needed. This uses PWA technology for a native experience.</p>
          </div>
        </div>
        <div className="hidden md:block px-3 py-1 bg-gray-100 text-gray-500 text-[10px] font-bold rounded-full uppercase tracking-widest">
          PWA Technology
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Desktop Step 1 */}
        <div className="p-6 bg-blue-50/50 rounded-xl border border-blue-100 space-y-4">
          <div className="flex items-center gap-2 text-blue-900 font-bold">
            <div className="w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs">1</div>
            <span>Publish & Launch</span>
          </div>
          <p className="text-xs text-blue-700 leading-relaxed">
            Browsers block installation inside the editor. For the best experience:
          </p>
          <div className="space-y-2">
            <p className="text-[10px] text-blue-800 font-medium">
              1. Click <strong>"Share"</strong> in the top right of AI Studio.<br/>
              2. Open that <strong>Shared URL</strong> in a new tab.<br/>
              3. The "Install" button will work there!
            </p>
          </div>
          <a 
            href={window.location.href} 
            target="_blank" 
            rel="noopener noreferrer"
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 text-white rounded-xl text-xs font-bold hover:bg-blue-700 transition-all shadow-md"
          >
            <ExternalLink size={14} />
            Launch Current Preview
          </a>
        </div>

        {/* Desktop Step 2 */}
        <div className="p-6 bg-gray-50 rounded-xl border border-gray-100 space-y-4">
          <div className="flex items-center gap-2 text-gray-900 font-bold">
            <div className="w-6 h-6 rounded-full bg-gray-400 text-white flex items-center justify-center text-xs">2</div>
            <span>Click Install</span>
          </div>
          
          {isSafari ? (
            <div className="space-y-3">
              <p className="text-xs text-blue-700 font-bold leading-relaxed">
                Safari detected!
              </p>
              <p className="text-[10px] text-gray-600 leading-relaxed">
                1. Go to <strong>File</strong> in the top menu bar.<br/>
                2. Select <strong>"Add to Dock..."</strong>.<br/>
                3. This installs the app to your iMac.
              </p>
              <div className="py-2 px-3 bg-blue-50 border border-blue-100 rounded-lg text-[9px] text-blue-600">
                Safari does not show an "Install" button like Chrome. Use the "Add to Dock" menu instead.
              </div>
            </div>
          ) : (
            <>
              <p className="text-xs text-gray-600 leading-relaxed">
                Once the new tab opens, click the button below. Your browser will ask to "Install App".
              </p>
              {deferredPrompt ? (
                <button 
                  onClick={handleInstallClick}
                  className="w-full py-3 bg-white border-2 border-blue-600 text-blue-600 rounded-xl text-xs font-bold hover:bg-blue-50 transition-all flex items-center justify-center gap-2"
                >
                  <Download size={14} />
                  Install to iMac
                </button>
              ) : (
                <div className="space-y-3">
                  <div className="py-3 px-4 bg-gray-200 text-gray-500 rounded-xl text-[10px] font-bold text-center italic">
                    Waiting for browser prompt...
                  </div>
                  {showManualInstructions && isChrome && (
                    <div className="p-3 bg-orange-50 border border-orange-100 rounded-lg space-y-2">
                      <p className="text-[10px] font-bold text-orange-800">Manual Install (Chrome/Edge):</p>
                      <p className="text-[9px] text-orange-700 leading-tight">
                        1. Look for the <strong>Install Icon</strong> (computer with arrow) in your <strong>Address Bar</strong> (top right).<br/>
                        2. OR click the <strong>Three Dots (⋮)</strong> menu {"->"} <strong>"Save and Share"</strong> {"->"} <strong>"Install page as app..."</strong>.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Mobile/iPhone */}
        <div className="p-6 bg-purple-50/50 rounded-xl border border-purple-100 space-y-4">
          <div className="flex items-center gap-2 text-purple-900 font-bold">
            <Smartphone size={18} className="text-purple-600" />
            <span>iPhone / iOS</span>
          </div>
          <div className="space-y-2">
            <p className="text-[10px] text-purple-700 font-medium">1. Open this URL in <strong>Safari</strong></p>
            <p className="text-[10px] text-purple-700 font-medium">2. Tap the <strong>Share</strong> icon (square + arrow)</p>
            <p className="text-[10px] text-purple-700 font-medium">3. Tap <strong>"Add to Home Screen"</strong></p>
          </div>
          <div className="pt-2 border-t border-purple-100">
            <p className="text-[9px] text-purple-600 italic">This creates an app icon on your iPhone just like a DMG does for Mac.</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="p-4 bg-yellow-50 rounded-xl border border-yellow-100 flex gap-3 items-start">
          <AlertCircle size={16} className="text-yellow-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="text-xs font-bold text-yellow-800">Why no DMG file?</p>
            <p className="text-[10px] text-yellow-700 leading-relaxed">
              Modern apps use "PWA" (Progressive Web App) technology. It's faster, safer, and stays updated automatically without you having to download new installers. Once installed, it works exactly like a native iMac app.
            </p>
          </div>
        </div>

        <div className="p-4 bg-gray-50 rounded-xl border border-gray-100 flex gap-3 items-start">
          <FileCode size={16} className="text-gray-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="text-xs font-bold text-gray-800">Option B: Run Locally (Advanced)</p>
            <p className="text-[10px] text-gray-600 leading-relaxed">
              If PWA installation fails, you can run the code directly on your iMac:<br/>
              1. Click the <strong>Settings</strong> icon (top right) {"->"} <strong>"Export to ZIP"</strong>.<br/>
              2. Unzip the file on your iMac.<br/>
              3. Open Terminal, type <code>npm install</code> then <code>npm run dev</code>.<br/>
              4. Open <code>http://localhost:3000</code> in your browser.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function FileCode({ size, className }: { size: number, className?: string }) {
  return <Download size={size} className={className} />;
}
