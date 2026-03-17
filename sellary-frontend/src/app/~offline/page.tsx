'use client';

import { SignalSlashIcon } from '@heroicons/react/24/outline';

export default function Offline() {
    return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 p-4">
            <div className="bg-white p-8 rounded-2xl shadow-lg text-center max-w-md w-full">
                <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <SignalSlashIcon className="w-8 h-8 text-red-600" />
                </div>
                <h1 className="text-2xl font-bold text-gray-900 mb-2">Internet yo&apos;q</h1>
                <p className="text-gray-500 mb-6">
                    Siz oflayn rejimdasiz. Internetga ulanishingiz bilan dastur ishlashda davom etadi.
                    <br />
                    <span className="text-sm text-blue-500 mt-2 block">
                        (Agar oldinroq kirgan sahifalaringiz bo&apos;lsa, ular oflayn ham ishlashi kerak)
                    </span>
                </p>
                <button
                    onClick={() => window.location.reload()}
                    className="w-full py-2 px-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
                >
                    Qayta urinish
                </button>
            </div>
        </div>
    );
}
