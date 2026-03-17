import Image from 'next/image';

export default function LoadingSpinner({ size = 64, className = '' }: { size?: number, className?: string }) {
    return (
        <div className={`flex flex-col items-center justify-center ${className}`}>
            <div className="relative animate-pulse">
                <svg
                    width={size}
                    height={size}
                    viewBox="0 0 512 512"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                    className="animate-[spin_3s_linear_infinite]"
                >
                    <rect width="512" height="512" rx="128" fill="#2563EB" />
                    <path
                        d="M344 184C344 161.909 326.091 144 304 144H208C185.909 144 168 161.909 168 184V200C168 222.091 185.909 240 208 240H288C296.837 240 304 247.163 304 256V272C304 280.837 296.837 288 288 288H184M168 328C168 350.091 185.909 368 208 368H304C326.091 368 344 350.091 344 328V312C344 289.909 326.091 272 304 272H224C215.163 272 208 264.837 208 256V240C208 231.163 215.163 224 224 224H328"
                        stroke="white"
                        strokeWidth="32"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    />
                </svg>
            </div>
            <p className="mt-4 text-sm font-medium text-gray-500 animate-pulse">Загрузка...</p>
        </div>
    );
}
