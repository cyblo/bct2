import { useState } from 'react';
import { createDID, issueCredential, uploadFile, onchainSubmitClaim, getVCByPolicyId } from './api';
import ConnectWallet from './ConnectWallet';
import CollapsibleCard from './components/CollapsibleCard';
import QRCode from 'qrcode';
import { formatDate } from './utils/formatting';

function ProviderDashboard() {
  const [wallet, setWallet] = useState(null);
  const [did, setDid] = useState(null);
  const [message, setMessage] = useState(null);
  const [loading, setLoading] = useState(false);
  const [vcForm, setVcForm] = useState({ facility: '', speciality: '' });
  const [vcInfo, setVcInfo] = useState(null);
  const [vcQr, setVcQr] = useState('');

  // Treatment Credential Issuance state
  const [treatmentForm, setTreatmentForm] = useState({
    patientDid: '',
    treatmentDescription: '',
    billAmount: '',
  });
  const [treatmentFiles, setTreatmentFiles] = useState([]);
  const [treatmentFileCids, setTreatmentFileCids] = useState([]);
  const [issuedTreatmentVC, setIssuedTreatmentVC] = useState(null);

  // Claim Submission state
  const [claimForm, setClaimForm] = useState({
    patientWalletOrDid: '',
    policyId: '',
    amount: '',
    fileCids: '',
  });

  // Issued VCs and Claims state
  const [issuedVCs, setIssuedVCs] = useState([]);
  const [submittedClaims, setSubmittedClaims] = useState([]);
  const [viewingVC, setViewingVC] = useState(null);

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

  // Treatment Credential Issuance handlers
  const handleTreatmentFileChange = (e) => {
    const files = Array.from(e.target.files);
    setTreatmentFiles(files);
  };

  const handleUploadTreatmentFiles = async () => {
    if (treatmentFiles.length === 0) {
      setMessage({ type: 'error', text: 'Please select files to upload' });
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      const cids = [];
      for (const file of treatmentFiles) {
        const reader = new FileReader();
        await new Promise((resolve, reject) => {
          reader.onload = async (e) => {
            try {
              const base64Data = e.target.result.split(',')[1] || e.target.result;
              const result = await uploadFile(base64Data, file.name);
              if (result.success) {
                cids.push(result.cid);
              }
              resolve();
            } catch (error) {
              reject(error);
            }
          };
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
      }
      setTreatmentFileCids(cids);
      setMessage({ type: 'success', text: `Uploaded ${cids.length} file(s) successfully!` });
    } catch (error) {
      setMessage({ type: 'error', text: error.message || 'Failed to upload files' });
    } finally {
      setLoading(false);
    }
  };

  const handleIssueTreatmentCredential = async () => {
    if (!did) {
      setMessage({ type: 'error', text: 'Create your DID first' });
      return;
    }
    if (!treatmentForm.patientDid || !treatmentForm.treatmentDescription || !treatmentForm.billAmount) {
      setMessage({ type: 'error', text: 'Please fill all required fields' });
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      const payload = {
        issuerDid: did,
        subjectDid: treatmentForm.patientDid,
        role: 'TreatmentCredential',
        data: {
          credentialType: 'Treatment Credential',
          treatmentDescription: treatmentForm.treatmentDescription,
          billAmount: treatmentForm.billAmount,
          billAmountETH: treatmentForm.billAmount,
          supportingDocuments: treatmentFileCids,
          issuedAt: new Date().toISOString(),
        },
      };
      const result = await issueCredential(payload);
      setIssuedTreatmentVC({
        vc: result.vc,
        vcId: `vc-${Date.now()}`,
        patientDid: treatmentForm.patientDid,
        cid: result.cid,
      });
      // Add to issued VCs list
      setIssuedVCs([...issuedVCs, {
        id: `vc-${Date.now()}`,
        patientDid: treatmentForm.patientDid,
        createdAt: new Date().toISOString(),
        vc: result.vc,
        cid: result.cid,
      }]);
      setMessage({ type: 'success', text: 'Treatment credential issued successfully!' });
      // Reset form
      setTreatmentForm({ patientDid: '', treatmentDescription: '', billAmount: '' });
      setTreatmentFiles([]);
      setTreatmentFileCids([]);
    } catch (error) {
      setMessage({ type: 'error', text: error.message || 'Failed to issue treatment credential' });
    } finally {
      setLoading(false);
    }
  };

  // Claim Submission handler
  const handleSubmitClaim = async () => {
    if (!wallet?.account) {
      setMessage({ type: 'error', text: 'Please connect wallet first' });
      return;
    }
    if (!claimForm.patientWalletOrDid || !claimForm.policyId || !claimForm.amount) {
      setMessage({ type: 'error', text: 'Please fill all required fields' });
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      // Get VC by policy ID
      let vcCid = '';
      try {
        const vcResult = await getVCByPolicyId(claimForm.policyId);
        if (vcResult.success && vcResult.vc) {
          // Extract CID from VC if available
          vcCid = vcResult.vc.cid || '';
        }
      } catch (vcError) {
        console.warn('Could not fetch VC:', vcError);
      }

      // Convert ETH to wei
      const amountWei = (parseFloat(claimForm.amount) * 1e18).toString();
      const fileCidsArray = claimForm.fileCids.split(',').map(cid => cid.trim()).filter(cid => cid);

      // Use first CID as IPFS hash, or combine them
      const ipfsHash = fileCidsArray.length > 0 ? fileCidsArray[0] : '';

      const result = await onchainSubmitClaim({
        policyId: claimForm.policyId,
        beneficiary: claimForm.patientWalletOrDid.startsWith('0x') 
          ? claimForm.patientWalletOrDid 
          : wallet.account, // Use wallet if DID provided
        insurer: wallet.account, // This should be fetched from policy, but using wallet for now
        ipfsHash: ipfsHash,
        vcCid: vcCid,
        amount: amountWei,
      });

      if (result.success) {
        setMessage({ type: 'success', text: `Claim submitted successfully! Claim ID: ${result.claimId}` });
        // Add to submitted claims
        setSubmittedClaims([...submittedClaims, {
          claimId: result.claimId,
          patientDid: claimForm.patientWalletOrDid,
          amount: claimForm.amount,
          status: 'Submitted',
          txHash: result.txHash || 'N/A',
          createdAt: new Date().toISOString(),
        }]);
        // Reset form
        setClaimForm({ patientWalletOrDid: '', policyId: '', amount: '', fileCids: '' });
      } else {
        setMessage({ type: 'error', text: result.error || 'Failed to submit claim' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: error.message || 'Failed to submit claim' });
    } finally {
      setLoading(false);
    }
  };

  // Copy JWT to clipboard
  const copyJWT = (vc) => {
    try {
      if (!vc) {
        setMessage({ type: 'error', text: 'VC not available' });
        return;
      }
      
      // If VC is a string (JWT format), use it directly
      if (typeof vc === 'string') {
        navigator.clipboard.writeText(vc);
        setMessage({ type: 'success', text: 'JWT copied to clipboard!' });
        return;
      }
      
      // If VC is an object, try to find JWT in various places
      if (typeof vc === 'object') {
        // Check if it's in proof.jwt
        if (vc.proof && vc.proof.jwt) {
          navigator.clipboard.writeText(vc.proof.jwt);
          setMessage({ type: 'success', text: 'JWT copied to clipboard!' });
          return;
        }
        // Check if the entire object is stringifiable and might contain JWT
        const vcStr = JSON.stringify(vc);
        if (vcStr.length > 100) {
          navigator.clipboard.writeText(vcStr);
          setMessage({ type: 'success', text: 'VC data copied to clipboard!' });
          return;
        }
      }
      
      setMessage({ type: 'error', text: 'JWT not found in VC' });
    } catch (error) {
      setMessage({ type: 'error', text: 'Failed to copy JWT: ' + error.message });
    }
  };

  // Download VC JSON
  const downloadVC = (vc) => {
    try {
      let dataStr;
      if (typeof vc === 'string') {
        // If it's a JWT string, wrap it in an object
        dataStr = JSON.stringify({ jwt: vc }, null, 2);
      } else {
        dataStr = JSON.stringify(vc, null, 2);
      }
      const dataBlob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(dataBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `vc-${Date.now()}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setMessage({ type: 'error', text: 'Failed to download VC: ' + error.message });
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="text-center mb-8">
        <h1 className="text-4xl font-bold text-gray-800 mb-2">Provider Dashboard</h1>
        <p className="text-gray-600">Create your DID and share verifiable credentials</p>
      </div>

      <CollapsibleCard title="Wallet Connection" icon="🔗" defaultOpen={true}>
        <ConnectWallet onWalletConnected={setWallet} />
      </CollapsibleCard>

      <CollapsibleCard title="Provider Identity" icon="🏥" defaultOpen={true}>
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

      <CollapsibleCard title="Provider Credential & QR" icon="🔑" defaultOpen={true}>
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
      <CollapsibleCard title="Treatment Credential Issuance" icon="🏥" defaultOpen={true}>
        <div className="space-y-4">
          <div>
            <label className="label">Patient DID *</label>
            <input
              type="text"
              className="input-field"
              value={treatmentForm.patientDid}
              onChange={(e) => setTreatmentForm({ ...treatmentForm, patientDid: e.target.value })}
              placeholder="did:example:patient123"
            />
          </div>
          <div>
            <label className="label">Treatment Description *</label>
            <textarea
              className="input-field"
              rows="3"
              value={treatmentForm.treatmentDescription}
              onChange={(e) => setTreatmentForm({ ...treatmentForm, treatmentDescription: e.target.value })}
              placeholder="Describe the treatment provided..."
            />
          </div>
          <div>
            <label className="label">Bill Amount (ETH) *</label>
            <input
              type="number"
              step="0.0001"
              className="input-field"
              value={treatmentForm.billAmount}
              onChange={(e) => setTreatmentForm({ ...treatmentForm, billAmount: e.target.value })}
              placeholder="0.5"
            />
          </div>
          <div>
            <label className="label">Upload Supporting Documents</label>
            <input
              type="file"
              multiple
              className="input-field"
              onChange={handleTreatmentFileChange}
            />
            {treatmentFiles.length > 0 && (
              <p className="text-sm text-gray-600 mt-1">
                {treatmentFiles.length} file(s) selected
              </p>
            )}
            <button
              className="btn btn-secondary mt-2"
              onClick={handleUploadTreatmentFiles}
              disabled={loading || treatmentFiles.length === 0}
            >
              {loading ? 'Uploading...' : 'Upload Files'}
            </button>
            {treatmentFileCids.length > 0 && (
              <div className="mt-2 p-2 bg-green-50 rounded border border-green-200">
                <p className="text-sm text-green-800 font-semibold">Uploaded CIDs:</p>
                {treatmentFileCids.map((cid, idx) => (
                  <p key={idx} className="text-xs font-mono text-green-700 break-all">{cid}</p>
                ))}
              </div>
            )}
          </div>
          <button
            className="btn btn-primary"
            onClick={handleIssueTreatmentCredential}
            disabled={loading || !did}
          >
            {loading ? 'Issuing...' : 'Issue Treatment Credential'}
          </button>

          {/* Treatment VC Preview Card */}
          {issuedTreatmentVC && (
            <div className="mt-4 p-4 bg-blue-50 rounded-lg border border-blue-200">
              <h3 className="font-semibold text-blue-900 mb-3">Treatment Credential Issued</h3>
              <div className="space-y-2 text-sm">
                <div>
                  <span className="font-semibold">VC ID:</span>
                  <p className="font-mono text-xs break-all">{issuedTreatmentVC.vcId}</p>
                </div>
                <div>
                  <span className="font-semibold">Patient DID:</span>
                  <p className="font-mono text-xs break-all">{issuedTreatmentVC.patientDid}</p>
                </div>
                <div className="flex gap-2 mt-3">
                  <button
                    className="btn btn-sm btn-secondary"
                    onClick={() => downloadVC(issuedTreatmentVC.vc)}
                  >
                    Download VC JSON
                  </button>
                  <button
                    className="btn btn-sm btn-secondary"
                    onClick={() => copyJWT(issuedTreatmentVC.vc)}
                  >
                    Copy JWT
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </CollapsibleCard>

      {/* Claim Submission Section */}
      <CollapsibleCard title="Claim Submission" icon="📋" defaultOpen={true}>
        <div className="space-y-4">
          <div>
            <label className="label">Patient Wallet or DID *</label>
            <input
              type="text"
              className="input-field"
              value={claimForm.patientWalletOrDid}
              onChange={(e) => setClaimForm({ ...claimForm, patientWalletOrDid: e.target.value })}
              placeholder="0x... or did:example:..."
            />
          </div>
          <div>
            <label className="label">Policy ID *</label>
            <input
              type="text"
              className="input-field"
              value={claimForm.policyId}
              onChange={(e) => setClaimForm({ ...claimForm, policyId: e.target.value })}
              placeholder="Policy ID"
            />
          </div>
          <div>
            <label className="label">Amount (ETH) *</label>
            <input
              type="number"
              step="0.0001"
              className="input-field"
              value={claimForm.amount}
              onChange={(e) => setClaimForm({ ...claimForm, amount: e.target.value })}
              placeholder="0.5"
            />
          </div>
          <div>
            <label className="label">File CIDs (comma-separated)</label>
            <input
              type="text"
              className="input-field"
              value={claimForm.fileCids}
              onChange={(e) => setClaimForm({ ...claimForm, fileCids: e.target.value })}
              placeholder="Qm..., Qm... (or use CIDs from uploaded documents above)"
            />
            {treatmentFileCids.length > 0 && (
              <button
                className="btn btn-sm btn-secondary mt-2"
                onClick={() => setClaimForm({ ...claimForm, fileCids: treatmentFileCids.join(', ') })}
              >
                Use Uploaded CIDs
              </button>
            )}
          </div>
          <button
            className="btn btn-primary"
            onClick={handleSubmitClaim}
            disabled={loading || !wallet}
          >
            {loading ? 'Submitting...' : 'Submit Claim'}
          </button>
        </div>
      </CollapsibleCard>

      {/* Issued VC List Section */}
      <CollapsibleCard title="Issued VC List" icon="📜" defaultOpen={true}>
        {issuedVCs.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <p>No treatment credentials issued yet</p>
          </div>
        ) : (
          <div className="space-y-3">
            {issuedVCs.map((vc, idx) => (
              <div key={vc.id || idx} className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1">
                    <h4 className="font-semibold text-gray-800">Treatment VC #{idx + 1}</h4>
                    <p className="text-xs font-mono text-gray-600 break-all mt-1">ID: {vc.id}</p>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm mb-3">
                  <div>
                    <span className="text-gray-600">Patient DID:</span>
                    <p className="font-mono text-xs text-gray-800 break-all">{vc.patientDid}</p>
                  </div>
                  <div>
                    <span className="text-gray-600">Created At:</span>
                    <p className="text-gray-800">{formatDate(vc.createdAt)}</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    className="btn btn-sm btn-primary"
                    onClick={() => setViewingVC(vc)}
                  >
                    View VC
                  </button>
                  <button
                    className="btn btn-sm btn-secondary"
                    onClick={() => downloadVC(vc.vc)}
                  >
                    Download VC
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CollapsibleCard>

      {/* Claims Submitted by Provider Section */}
      <CollapsibleCard title="Claims Submitted by Provider" icon="💼" defaultOpen={true}>
        {submittedClaims.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <p>No claims submitted yet</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-gray-100">
                  <th className="border border-gray-300 px-4 py-2 text-left text-sm font-semibold">Claim ID</th>
                  <th className="border border-gray-300 px-4 py-2 text-left text-sm font-semibold">Patient DID</th>
                  <th className="border border-gray-300 px-4 py-2 text-left text-sm font-semibold">Amount (ETH)</th>
                  <th className="border border-gray-300 px-4 py-2 text-left text-sm font-semibold">Status</th>
                  <th className="border border-gray-300 px-4 py-2 text-left text-sm font-semibold">TxHash</th>
                </tr>
              </thead>
              <tbody>
                {submittedClaims.map((claim, idx) => (
                  <tr key={idx} className="hover:bg-gray-50">
                    <td className="border border-gray-300 px-4 py-2 text-sm">{claim.claimId}</td>
                    <td className="border border-gray-300 px-4 py-2 text-sm font-mono text-xs break-all max-w-xs">
                      {claim.patientDid}
                    </td>
                    <td className="border border-gray-300 px-4 py-2 text-sm">{claim.amount}</td>
                    <td className="border border-gray-300 px-4 py-2 text-sm">
                      <span className={`px-2 py-1 rounded text-xs font-semibold ${
                        claim.status === 'Submitted' ? 'bg-yellow-100 text-yellow-800' :
                        claim.status === 'Approved' ? 'bg-green-100 text-green-800' :
                        claim.status === 'Rejected' ? 'bg-red-100 text-red-800' :
                        'bg-gray-100 text-gray-800'
                      }`}>
                        {claim.status}
                      </span>
                    </td>
                    <td className="border border-gray-300 px-4 py-2 text-sm font-mono text-xs break-all max-w-xs">
                      {claim.txHash}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CollapsibleCard>

      {/* VC View Modal */}
      {viewingVC && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-auto">
            <div className="p-6">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-bold">Verifiable Credential Details</h3>
                <button
                  className="text-gray-500 hover:text-gray-700"
                  onClick={() => setViewingVC(null)}
                >
                  ✕
                </button>
              </div>
              <pre className="bg-gray-50 p-4 rounded text-xs overflow-auto max-h-96">
                {JSON.stringify(viewingVC.vc || viewingVC, null, 2)}
              </pre>
              <div className="flex gap-2 mt-4">
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    downloadVC(viewingVC.vc || viewingVC);
                    setViewingVC(null);
                  }}
                >
                  Download VC
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={() => {
                    copyJWT(viewingVC.vc || viewingVC);
                  }}
                >
                  Copy JWT
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={() => setViewingVC(null)}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {message && (
        <div className={`alert ${message.type === 'error' ? 'alert-error' : 'alert-success'} animate-slide-up`}>
          <div className="flex items-center space-x-2">
            <span>{message.type === 'error' ? '❌' : '✓'}</span>
            <span>{message.text}</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default ProviderDashboard;



