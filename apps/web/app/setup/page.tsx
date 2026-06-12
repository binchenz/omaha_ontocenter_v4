'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

type Step = 'llm' | 'account';

export default function SetupPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('llm');
  const [apiKey, setApiKey] = useState('');
  const [llmOk, setLlmOk] = useState(false);
  const [llmError, setLlmError] = useState('');
  const [testing, setTesting] = useState(false);

  const [tenantName, setTenantName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const testLlm = async () => {
    setTesting(true); setLlmError('');
    try {
      const res = await api.setupTestLlm(apiKey);
      if (res.ok) { setLlmOk(true); } else { setLlmError(res.error ?? '连接失败'); }
    } catch { setLlmError('连接失败'); }
    finally { setTesting(false); }
  };

  const handleInit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true); setSubmitError('');
    try {
      await api.setupInitialize({ tenantName, adminEmail, adminPassword, apiKey });
      router.push('/login');
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : '初始化失败');
    } finally { setSubmitting(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-gray-900 mb-4">
            <span className="text-white text-sm font-bold">OC</span>
          </div>
          <h1 className="text-xl font-semibold text-gray-900">初始化 OntoCenter</h1>
          <p className="text-xs text-gray-400 mt-1">步骤 {step === 'llm' ? 1 : 2} / 2</p>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
          {step === 'llm' ? (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">DeepSeek API Key</label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={e => { setApiKey(e.target.value); setLlmOk(false); setLlmError(''); }}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900"
                  placeholder="sk-..."
                />
              </div>
              {llmError && <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{llmError}</p>}
              {llmOk && <p className="text-xs text-green-600 bg-green-50 border border-green-100 rounded-lg px-3 py-2">✓ 连接成功</p>}
              <button onClick={testLlm} disabled={!apiKey || testing} className="w-full py-2 px-4 bg-gray-100 text-gray-900 text-sm font-medium rounded-lg hover:bg-gray-200 disabled:opacity-50 transition-colors">
                {testing ? '测试中...' : '测试连接'}
              </button>
              <button onClick={() => setStep('account')} disabled={!llmOk} className="w-full py-2 px-4 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 disabled:opacity-50 transition-colors">
                下一步
              </button>
            </div>
          ) : (
            <form onSubmit={handleInit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">企业名称</label>
                <input type="text" value={tenantName} onChange={e => setTenantName(e.target.value)} required className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900" placeholder="我的公司" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">管理员邮箱</label>
                <input type="email" value={adminEmail} onChange={e => setAdminEmail(e.target.value)} required className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">管理员密码</label>
                <input type="password" value={adminPassword} onChange={e => setAdminPassword(e.target.value)} required minLength={6} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900" />
              </div>
              {submitError && <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{submitError}</p>}
              <div className="flex gap-2">
                <button type="button" onClick={() => setStep('llm')} className="flex-1 py-2 px-4 bg-gray-100 text-gray-900 text-sm font-medium rounded-lg hover:bg-gray-200 transition-colors">返回</button>
                <button type="submit" disabled={submitting} className="flex-1 py-2 px-4 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 disabled:opacity-50 transition-colors">
                  {submitting ? '初始化中...' : '完成初始化'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
