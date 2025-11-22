import { useState, useEffect } from 'react';
import { createDID, issueCredential, uploadFile, onchainSubmitClaim } from './api';
import ConnectWallet from './ConnectWallet';
import CollapsibleCard from './components/CollapsibleCard';
import QRCode from 'qrcode';

function ProviderDashboard() {
  const [wallet, setWallet] = useState(null);
  const [did, setDid] = useState(null);
  const [message, setMessage] = useState(null);
  const [loading, setLoading] = useState(false);
  const [vcForm, setVcForm] = useState({ facility: '', speciality: '' });
  const [vcInfo, setVcInfo] = useState(null);
  const [vcQr, setVcQr] = useState('');
  
  // Treatment VC state
  const [treatmentForm, setTreatmentForm] = useState({
    patientDid: '',
    treatment: '',
    billAmount: '',
  });
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [uploadedCids, setUploadedCids] = useState([]);
  const [issuedTreatmentVCs, setIssuedTreatmentVCs] = useState([]);
  
  // Claim submission state
  const [claimForm, setClaimForm] = useState({
    patientWallet: '',
    patientDid: '',
    policyId: '',
    amount: '',
  });
  const [submittedClaims, setSubmittedClaims] = useState([]);
  const [selectedVC, setSelectedVC] = useState(null);

  const handleCreateDID = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const result = await createDID();
      if (result.success) {
        setDid(result.did);
        setMessage({ type: 'success', text: 'Provider DID created successfully!' });
      } else {
        setMessage({ type: 'error', text: result.error || 'Failed to create DID' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: error.message || 'Failed to create DID' });
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateVC = async () => {
    if (!did) {
      setMessage({ type: 'error', text: 'Create your DID first' });
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      const payload = {
        issuerDid: did,
        subjectDid: did,
        role: 'Provider',
        data: {
          facility: vcForm.facility || 'Health Facility',
          speciality: vcForm.speciality || 'General Practice',
          issuedAt: new Date().toISOString(),
        },
      };
      const result = await issueCredential(payload);
      setVcInfo(result.vc);
      const qr = await QRCode.toDataURL(JSON.stringify(result.vc));
      setVcQr(qr);
      setMessage({ type: 'success', text: 'Provider credential generated!' });
    } catch (error) {
      setMessage({ type: 'error', text: error.message || 'Failed to generate credential' });
    } finally {
      setLoading(false);
    }
  };

  // Treatment VC handlers
  const handleFileUpload = async (event) => {
    const files = Array.from(event.target.files);
    if (files.length === 0) return;

    setLoading(true);
    setMessage(null);
    try {
      const cids = [];
      for (const file of files) {
        const reader = new FileReader();
        const fileData = await new Promise((resolve, reject) => {
          reader.onload = (e) => resolve(e.target.result);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        
        const base64Data = fileData.split(',')[1] || fileData;
        const result = await uploadFile(base64Data, file.name);
        if (result.success && result.cid) {
          cids.push({ cid: result.cid, filename: file.name });
        }
      }
      setUploadedCids([...uploadedCids, ...cids]);
      setUploadedFiles([...uploadedFiles, ...files]);
      setMessage({ type: 'success', text: `Uploaded ${cids.length} file(s) successfully` });
    } catch (error) {
      setMessage({ type: 'error', text: error.message || 'Failed to upload files' });
    } finally {
      setLoading(false);
    }
  };

  const handleIssueTreatmentVC = async () => {
    if (!did) {
      setMessage({ type: 'error', text: 'Create your Provider DID first' });
      return;
    }
    if (!treatmentForm.patientDid || !treatmentForm.treatment) {
      setMessage({ type: 'error', text: 'Patient DID and Treatment Description are required' });
      return;
    }

    setLoading(true);
    setMessage(null);
    try {
      const payload = {
        issuerDid: did,
        subjectDid: treatmentForm.patientDid,
        role: 'Treatment',
        data: {
          treatment: treatmentForm.treatment,
          billAmount: treatmentForm.billAmount || '0',
          fileCids: uploadedCids.map(f => f.cid),
          issuedAt: new Date().toISOString(),
        },
      };
      const result = await issueCredential(payload);
      
      const vcData = {
        id: `treatment-vc-${Date.now()}`,
        patientDid: treatmentForm.patientDid,
        treatment: treatmentForm.treatment,
        billAmount: treatmentForm.billAmount,
        cid: result.cid,
        jwt: result.vc,
        createdAt: new Date().toISOString(),
      };
      
      setIssuedTreatmentVCs([vcData, ...issuedTreatmentVCs]);
      setMessage({ type: 'success', text: 'Treatment credential issued successfully!' });
      
      // Reset form
      setTreatmentForm({ patientDid: '', treatment: '', billAmount: '' });
      setUploadedCids([]);
      setUploadedFiles([]);
    } catch (error) {
      setMessage({ type: 'error', text: error.message || 'Failed to issue treatment credential' });
    } finally {
      setLoading(false);
    }
  };

  // Claim submission handler
  const handleSubmitClaim = async () => {
    if (!claimForm.patientWallet && !claimForm.patientDid) {
      setMessage({ type: 'error', text: 'Patient Wallet or DID is required' });
      return;
    }
    if (!claimForm.amount) {
      setMessage({ type: 'error', text: 'Amount is required' });
      return;
    }

    setLoading(true);
    setMessage(null);
    try {
      const amountWei = BigInt(parseFloat(claimForm.amount || 0) * 1e18).toString();
      const fileCids = uploadedCids.map(f => f.cid).join(',');
      
      const claimData = {
        policyId: claimForm.policyId || '0',
        beneficiary: claimForm.patientWallet || claimForm.patientDid,
        insurer: '0x0000000000000000000000000000000000000000', // Should be fetched from policy
        ipfsHash: fileCids,
        vcCid: '',
        amount: amountWei,
      };

      const result = await onchainSubmitClaim(claimData);
      
      const claim = {
        id: `claim-${Date.now()}`,
        claimId: result.claimId || result.txHash?.substring(0, 10),
        patientDid: claimForm.patientDid || claimForm.patientWallet,
        amount: claimForm.amount,
        status: 'Submitted',
        txHash: result.txHash || 'pending',
        createdAt: new Date().toISOString(),
      };
      
      setSubmittedClaims([claim, ...submittedClaims]);
      setMessage({ type: 'success', text: `Claim submitted successfully! Claim ID: ${claim.claimId}` });
      
      // Reset form
      setClaimForm({ patientWallet: '', patientDid: '', policyId: '', amount: '' });
    } catch (error) {
      setMessage({ type: 'error', text: error.message || 'Failed to submit claim' });
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadVC = (vc) => {
    const dataStr = JSON.stringify(vc, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `treatment-vc-${vc.id}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleCopyJWT = (jwt) => {
    navigator.clipboard.writeText(jwt);
    setMessage({ type: 'success', text: 'VC JWT copied to clipboard!' });
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="text-center mb-8">
        <h1 className="text-4xl font-bold text-gray-800 mb-2">Provider Dashboard</h1>
        <p className="text-gray-600">Create your DID and share verifiable credentials</p>
      </div>

      {/* Wallet Connection - Collapsible */}
      <CollapsibleCard title="Wallet Connection" defaultOpen={false} icon="🔗">
        <ConnectWallet onWalletConnected={setWallet} />
      </CollapsibleCard>

      {/* Provider Identity - Collapsible */}
      <CollapsibleCard title="Provider Identity" defaultOpen={false} icon="🏥">
        {did ? (
          <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
            <label className="label">Your Provider DID</label>
            <p className="font-mono text-sm text-gray-700 break-all bg-white p-3 rounded border border-gray-200">
              {did}
            </p>
          </div>
        ) : (
          <button className="btn btn-primary" onClick={handleCreateDID} disabled={loading}>
            {loading ? 'Creating DID...' : 'Create Provider DID'}
          </button>
        )}
      </CollapsibleCard>

      {/* Provider Credential - Collapsible */}
      <CollapsibleCard title="Provider Credential & QR" defaultOpen={false} icon="🔑">
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="label">Facility / Organization</label>
            <input
              type="text"
              className="input-field"
              value={vcForm.facility}
              onChange={(e) => setVcForm({ ...vcForm, facility: e.target.value })}
              placeholder="City Hospital"
            />
            <label className="label">Speciality / Role</label>
            <input
              type="text"
              className="input-field"
              value={vcForm.speciality}
              onChange={(e) => setVcForm({ ...vcForm, speciality: e.target.value })}
              placeholder="Radiology Department"
            />
            <button className="btn btn-primary mt-3" onClick={handleGenerateVC} disabled={loading || !did}>
              {loading ? 'Generating...' : 'Generate Credential'}
            </button>
          </div>
          <div>
            {vcInfo ? (
              <div className="bg-gray-50 p-4 rounded-lg border">
                {vcQr && (
                  <div className="flex justify-center mb-4">
                    <img
                      src={vcQr}
                      alt="Provider VC QR"
                      className="w-48 h-48 object-contain border rounded-lg bg-white"
                    />
                  </div>
                )}
                <pre className="text-xs bg-white p-2 rounded max-h-64 overflow-auto">
                  {JSON.stringify(vcInfo, null, 2)}
                </pre>
              </div>
            ) : (
              <div className="text-gray-500 text-sm">Credential data will appear here once generated.</div>
            )}
          </div>
        </div>
      </CollapsibleCard>

      {/* Treatment Credential Issuance Section */}
      <CollapsibleCard title="Issue Treatment Credential" defaultOpen={true} icon="🏥">
        <div className="space-y-4">
          <div>
            <label className="label">Patient DID</label>
            <input
              type="text"
              className="input-field"
              value={treatmentForm.patientDid}
              onChange={(e) => setTreatmentForm({ ...treatmentForm, patientDid: e.target.value })}
              placeholder="did:ethr:0x..."
            />
          </div>
          <div>
            <label className="label">Treatment Description</label>
            <textarea
              className="input-field"
              rows="3"
              value={treatmentForm.treatment}
              onChange={(e) => setTreatmentForm({ ...treatmentForm, treatment: e.target.value })}
              placeholder="Describe the treatment provided..."
            />
          </div>
          <div>
            <label className="label">Bill Amount (ETH)</label>
            <input
              type="number"
              step="0.0001"
              className="input-field"
              value={treatmentForm.billAmount}
              onChange={(e) => setTreatmentForm({ ...treatmentForm, billAmount: e.target.value })}
              placeholder="0.0"
            />
          </div>
          <div>
            <label className="label">Upload Supporting Documents</label>
            <input
              type="file"
              multiple
              className="input-field"
              onChange={handleFileUpload}
              disabled={loading}
            />
            {uploadedCids.length > 0 && (
              <div className="mt-2 space-y-1">
                {uploadedCids.map((file, idx) => (
                  <div key={idx} className="text-xs text-gray-600 bg-gray-50 p-2 rounded">
                    {file.filename}: {file.cid}
                  </div>
                ))}
              </div>
            )}
          </div>
          <button
            className="btn btn-primary"
            onClick={handleIssueTreatmentVC}
            disabled={loading || !did}
          >
            {loading ? 'Issuing...' : 'Issue Treatment Credential'}
          </button>
        </div>
      </CollapsibleCard>

      {/* Claim Submission Section */}
      <CollapsibleCard title="Submit Claim" defaultOpen={true} icon="📝">
        <div className="space-y-4">
          <div>
            <label className="label">Patient Wallet or DID</label>
            <input
              type="text"
              className="input-field"
              value={claimForm.patientWallet || claimForm.patientDid}
              onChange={(e) => {
                const value = e.target.value;
                if (value.startsWith('did:')) {
                  setClaimForm({ ...claimForm, patientDid: value, patientWallet: '' });
                } else {
                  setClaimForm({ ...claimForm, patientWallet: value, patientDid: '' });
                }
              }}
              placeholder="0x... or did:ethr:0x..."
            />
          </div>
          <div>
            <label className="label">Policy ID</label>
            <input
              type="text"
              className="input-field"
              value={claimForm.policyId}
              onChange={(e) => setClaimForm({ ...claimForm, policyId: e.target.value })}
              placeholder="Policy ID (optional)"
            />
          </div>
          <div>
            <label className="label">Amount (ETH)</label>
            <input
              type="number"
              step="0.0001"
              className="input-field"
              value={claimForm.amount}
              onChange={(e) => setClaimForm({ ...claimForm, amount: e.target.value })}
              placeholder="0.0"
            />
          </div>
          <div>
            <label className="label">File CIDs (from uploaded documents)</label>
            <input
              type="text"
              className="input-field"
              value={uploadedCids.map(f => f.cid).join(', ')}
              readOnly
              placeholder="File CIDs will appear here after upload"
            />
          </div>
          <button
            className="btn btn-primary"
            onClick={handleSubmitClaim}
            disabled={loading}
          >
            {loading ? 'Submitting...' : 'Submit Claim'}
          </button>
        </div>
      </CollapsibleCard>

      {/* Issued VC List */}
      <CollapsibleCard title="Issued Treatment VCs" defaultOpen={false} icon="📋">
        {issuedTreatmentVCs.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            No treatment VCs issued yet
          </div>
        ) : (
          <div className="space-y-3">
            {issuedTreatmentVCs.map((vc) => (
              <div key={vc.id} className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1">
                    <div className="font-semibold text-gray-800">VC ID: {vc.id}</div>
                    <div className="text-sm text-gray-600 mt-1">Patient DID: {vc.patientDid}</div>
                    <div className="text-xs text-gray-500 mt-1">Created: {new Date(vc.createdAt).toLocaleString()}</div>
                  </div>
                </div>
                <div className="flex gap-2 mt-3">
                  <button
                    className="btn btn-sm btn-primary"
                    onClick={() => setSelectedVC(vc)}
                  >
                    View VC
                  </button>
                  <button
                    className="btn btn-sm btn-secondary"
                    onClick={() => handleDownloadVC(vc)}
                  >
                    Download VC JSON
                  </button>
                  {vc.jwt && (
                    <button
                      className="btn btn-sm btn-secondary"
                      onClick={() => handleCopyJWT(vc.jwt)}
                    >
                      Copy JWT
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CollapsibleCard>

      {/* Claims Submitted by Provider */}
      <CollapsibleCard title="Submitted Claims" defaultOpen={false} icon="📊">
        {submittedClaims.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            No claims submitted yet
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-gray-100">
                  <th className="border border-gray-300 px-4 py-2 text-left">Claim ID</th>
                  <th className="border border-gray-300 px-4 py-2 text-left">Patient DID</th>
                  <th className="border border-gray-300 px-4 py-2 text-left">Amount</th>
                  <th className="border border-gray-300 px-4 py-2 text-left">Status</th>
                  <th className="border border-gray-300 px-4 py-2 text-left">TxHash</th>
                </tr>
              </thead>
              <tbody>
                {submittedClaims.map((claim) => (
                  <tr key={claim.id} className="hover:bg-gray-50">
                    <td className="border border-gray-300 px-4 py-2 font-mono text-sm">{claim.claimId}</td>
                    <td className="border border-gray-300 px-4 py-2 font-mono text-xs break-all">{claim.patientDid}</td>
                    <td className="border border-gray-300 px-4 py-2">{claim.amount} ETH</td>
                    <td className="border border-gray-300 px-4 py-2">
                      <span className="px-2 py-1 bg-yellow-100 text-yellow-800 rounded text-xs">
                        {claim.status}
                      </span>
                    </td>
                    <td className="border border-gray-300 px-4 py-2 font-mono text-xs break-all">
                      {claim.txHash}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CollapsibleCard>

      {message && (
        <div className={`alert ${message.type === 'error' ? 'alert-error' : 'alert-success'} animate-slide-up`}>
          <div className="flex items-center space-x-2">
            <span>{message.type === 'error' ? '❌' : '✓'}</span>
            <span>{message.text}</span>
          </div>
        </div>
      )}

      {/* VC View Modal */}
      {selectedVC && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-auto">
            <div className="sticky top-0 bg-white border-b border-gray-200 p-4 flex items-center justify-between">
              <h3 className="text-xl font-bold text-gray-800">Treatment VC Details</h3>
              <button
                className="text-gray-500 hover:text-gray-700 text-2xl"
                onClick={() => setSelectedVC(null)}
              >
                ×
              </button>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <label className="label">VC ID</label>
                <p className="font-mono text-sm bg-gray-50 p-2 rounded">{selectedVC.id}</p>
              </div>
              <div>
                <label className="label">Patient DID</label>
                <p className="font-mono text-sm bg-gray-50 p-2 rounded break-all">{selectedVC.patientDid}</p>
              </div>
              <div>
                <label className="label">Treatment</label>
                <p className="text-sm bg-gray-50 p-2 rounded">{selectedVC.treatment}</p>
              </div>
              <div>
                <label className="label">Bill Amount</label>
                <p className="text-sm bg-gray-50 p-2 rounded">{selectedVC.billAmount} ETH</p>
              </div>
              {selectedVC.cid && (
                <div>
                  <label className="label">IPFS CID</label>
                  <p className="font-mono text-xs bg-gray-50 p-2 rounded break-all">{selectedVC.cid}</p>
                </div>
              )}
              {selectedVC.jwt && (
                <div>
                  <label className="label">VC JWT</label>
                  <pre className="text-xs bg-gray-50 p-2 rounded overflow-auto max-h-40 break-all">
                    {selectedVC.jwt}
                  </pre>
                </div>
              )}
              <div className="flex gap-2 pt-2">
                <button
                  className="btn btn-secondary"
                  onClick={() => handleDownloadVC(selectedVC)}
                >
                  Download JSON
                </button>
                {selectedVC.jwt && (
                  <button
                    className="btn btn-secondary"
                    onClick={() => handleCopyJWT(selectedVC.jwt)}
                  >
                    Copy JWT
                  </button>
                )}
                <button
                  className="btn btn-primary"
                  onClick={() => setSelectedVC(null)}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ProviderDashboard;



